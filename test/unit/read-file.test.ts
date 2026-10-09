// Contract tests for drive_read_file:
//  - Defect 1 (found 2026-08-11): large files must be fetched via byte ranges, never downloaded whole.
//  - Defect 3 (found 2026-08-11): Office files must be converted, never dumped as lossy binary text.
//  - Binary files must never be rendered as mojibake.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { registerReadFileTool } from "../../src/tools/read-file.js";
import {
  captureToolHandler,
  textOf,
  toArrayBuffer,
  parseRangeHeader,
  makeApiError,
} from "./helpers.js";

const GDOC_MIME = "application/vnd.google-apps.document";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

interface MockCalls {
  metadataGets: Array<Record<string, unknown>>;
  mediaGets: Array<{ params: Record<string, unknown>; options?: Record<string, unknown> }>;
  copies: Array<Record<string, unknown>>;
  exports: Array<Record<string, unknown>>;
  deletes: Array<Record<string, unknown>>;
}

function makeDriveMock(opts: {
  fileId: string;
  metadata: Record<string, unknown>;
  bytes?: Buffer;
  copyId?: string;
  exportText?: string;
  exportError?: Error;
}) {
  const calls: MockCalls = { metadataGets: [], mediaGets: [], copies: [], exports: [], deletes: [] };
  const drive = {
    files: {
      async get(params: Record<string, unknown>, options?: Record<string, unknown>) {
        if (params.alt === "media") {
          calls.mediaGets.push({ params, options });
          const bytes = opts.bytes ?? Buffer.alloc(0);
          const headers = (options?.headers ?? {}) as Record<string, string>;
          const range = headers.Range ?? headers.range;
          if (!range) return { data: toArrayBuffer(bytes) };
          const { start, end } = parseRangeHeader(range);
          return { data: toArrayBuffer(bytes.subarray(start, Math.min(end + 1, bytes.length))) };
        }
        calls.metadataGets.push(params);
        if (params.fileId === "root") return { data: { id: "root-id-001" } };
        return { data: { id: params.fileId, ...opts.metadata } };
      },
      async copy(params: Record<string, unknown>) {
        calls.copies.push(params);
        return { data: { id: opts.copyId ?? "tmp-copy-001" } };
      },
      async export(params: Record<string, unknown>) {
        calls.exports.push(params);
        if (opts.exportError) throw opts.exportError;
        return { data: opts.exportText ?? "" };
      },
      async delete(params: Record<string, unknown>) {
        calls.deletes.push(params);
        return { data: undefined };
      },
    },
  };
  return { drive, calls };
}

function handlerFor(drive: unknown) {
  return captureToolHandler(
    registerReadFileTool as (server: never, ...clients: never[]) => void,
    drive,
  ).handler;
}

describe("drive_read_file — range reads (defect 1)", () => {
  it("downloads only the default byte range of a large file and reports truncation", async () => {
    const bytes = Buffer.from("x".repeat(2_000_000), "utf8");
    const { drive, calls } = makeDriveMock({
      fileId: "big1",
      metadata: { name: "big.csv", mimeType: "text/csv", size: "2000000" },
      bytes,
    });
    const result = await handlerFor(drive)({ fileId: "big1" });
    const text = textOf(result);

    assert.equal(calls.mediaGets.length, 1, "exactly one media request");
    const headers = (calls.mediaGets[0].options?.headers ?? {}) as Record<string, string>;
    const range = headers.Range ?? headers.range;
    assert.ok(range, "media request must carry a Range header (never download the whole file)");
    const { start, end } = parseRangeHeader(range);
    assert.equal(start, 0);
    assert.equal(end, 199_999, "default window must be 200000 bytes");

    assert.ok(!result.isError, text);
    assert.match(text, /truncated/i, "response must state the content is truncated");
    assert.match(text, /offset=200000/, "response must tell the caller how to continue");
    assert.ok(text.length < 300_000, "response must not embed the whole file");
  });

  it("honors offset and maxBytes", async () => {
    const bytes = Buffer.from("0123456789".repeat(100), "utf8"); // 1000 bytes
    const { drive, calls } = makeDriveMock({
      fileId: "f2",
      metadata: { name: "digits.txt", mimeType: "text/plain", size: "1000" },
      bytes,
    });
    const result = await handlerFor(drive)({ fileId: "f2", offset: 100, maxBytes: 50 });
    const text = textOf(result);

    const headers = (calls.mediaGets[0].options?.headers ?? {}) as Record<string, string>;
    const { start, end } = parseRangeHeader(headers.Range ?? headers.range);
    assert.equal(start, 100);
    assert.equal(end, 149);
    assert.match(text, /01234567890123456789012345678901234567890123456789|0123456789/, "chunk content present");
    assert.match(text, /truncated/i);
  });

  it("returns a small text file whole, with no truncation notice (regression)", async () => {
    const bytes = Buffer.from("hello, plain content\n", "utf8");
    const { drive } = makeDriveMock({
      fileId: "f3",
      metadata: { name: "small.txt", mimeType: "text/plain", size: String(bytes.length) },
      bytes,
    });
    const result = await handlerFor(drive)({ fileId: "f3" });
    const text = textOf(result);
    assert.ok(!result.isError, text);
    assert.match(text, /hello, plain content/);
    assert.doesNotMatch(text, /truncated/i);
  });
});

describe("drive_read_file — Office conversion (defect 3)", () => {
  it("converts a .docx via a temporary Google Doc copy and cleans it up", async () => {
    const { drive, calls } = makeDriveMock({
      fileId: "docx1",
      metadata: { name: "report.docx", mimeType: DOCX_MIME, size: "6608" },
      copyId: "tmp-copy-42",
      exportText: "SMOKE-DOCX-MARKER converted text",
    });
    const result = await handlerFor(drive)({ fileId: "docx1" });
    const text = textOf(result);

    assert.ok(!result.isError, text);
    assert.equal(calls.copies.length, 1, "one conversion copy");
    const copyBody = calls.copies[0].requestBody as Record<string, unknown>;
    assert.equal(copyBody.mimeType, GDOC_MIME, "copy must request Google Doc conversion");
    assert.equal(calls.exports.length, 1);
    assert.equal(calls.exports[0].fileId, "tmp-copy-42");
    assert.equal(calls.deletes.length, 1, "temporary copy must be deleted");
    assert.equal(calls.deletes[0].fileId, "tmp-copy-42");
    assert.match(text, /SMOKE-DOCX-MARKER converted text/);
    assert.doesNotMatch(text, /�/, "no replacement characters in output");
  });

  it("cleans up the temporary copy even when the export fails", async () => {
    const { drive, calls } = makeDriveMock({
      fileId: "docx2",
      metadata: { name: "broken.docx", mimeType: DOCX_MIME, size: "1234" },
      copyId: "tmp-copy-43",
      exportError: makeApiError(500, "export exploded"),
    });
    const result = await handlerFor(drive)({ fileId: "docx2" });

    assert.equal(result.isError, true);
    assert.equal(calls.deletes.length, 1, "temporary copy must be deleted on failure too");
    assert.equal(calls.deletes[0].fileId, "tmp-copy-43");
  });
});

// Minimal real-looking PDF: a page tree with `pages` pages; text pages draw with BT…Tj, scans only paint an image.
function pdfBytes(pages: number, kind: "text" | "scan" = "text"): Buffer {
  const content = kind === "text" ? "BT /F1 11 Tf 56 780 Td (Factura) Tj ET" : "q 595 0 0 842 0 0 cm /Im0 Do Q";
  return Buffer.from(
    "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
      `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count ${pages} >>\nendobj\n` +
      "3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>\nendobj\n" +
      `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n` +
      "trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n0\n%%EOF\n",
    "latin1",
  );
}

describe("drive_read_file — PDF text extraction (defect 4, found 2026-10-10)", () => {
  it("converts a PDF via a temporary Google Doc copy, never dumps its bytes, and cleans up", async () => {
    const bytes = pdfBytes(1);
    const { drive, calls } = makeDriveMock({
      fileId: "pdf1",
      metadata: { name: "Invoice-0001.pdf", mimeType: "application/pdf", size: String(bytes.length) },
      bytes,
      copyId: "tmp-copy-pdf",
      exportText: "Invoice number AIZT4BCC-0004 VAT - Spain (21% on 90.00)",
    });
    const result = await handlerFor(drive)({ fileId: "pdf1" });
    const text = textOf(result);

    assert.ok(!result.isError, text);
    assert.equal(calls.mediaGets.length, 1, "downloaded once, only for local inspection");
    assert.doesNotMatch(text, /%PDF|endstream/, "raw PDF bytes must never reach the response");
    assert.equal(calls.copies.length, 1, "one conversion copy");
    const copyBody = calls.copies[0].requestBody as Record<string, unknown>;
    assert.equal(copyBody.mimeType, GDOC_MIME, "copy must request Google Doc conversion");
    assert.equal(calls.exports[0].fileId, "tmp-copy-pdf");
    assert.equal(calls.deletes.length, 1, "temporary copy must be deleted");
    assert.equal(calls.deletes[0].fileId, "tmp-copy-pdf");
    assert.match(text, /AIZT4BCC-0004/);
    assert.match(text, /PDF/, "response must say the text comes from a PDF conversion");
    assert.doesNotMatch(text, /Office format/, "a PDF is not an Office file");
  });

  it("omits embedded base64 images from the converted text and says how many", async () => {
    const base64 = "iVBORw0KGgo" + "A".repeat(50_000);
    const { drive } = makeDriveMock({
      fileId: "pdf3",
      metadata: { name: "scan.pdf", mimeType: "application/pdf", size: "900000" },
      exportText: `**Invoice** total 108.90\n![][image1]\n![][image2]\n\n[image1]: <data:image/png;base64,${base64}>\n[image2]: <data:image/jpeg;base64,${base64}>`,
    });
    const result = await handlerFor(drive)({ fileId: "pdf3" });
    const text = textOf(result);

    assert.ok(!result.isError, text);
    assert.match(text, /total 108\.90/, "the real text survives");
    assert.doesNotMatch(text, /base64/, "no embedded image data in the response");
    assert.match(text, /2 embedded image\(s\) omitted/);
    assert.ok(text.length < 2_000, "the response must not carry the image payload");
  });

  it("with convertOffice=false reports the PDF as binary without copying or downloading it", async () => {
    const { drive, calls } = makeDriveMock({
      fileId: "pdf2",
      metadata: { name: "scan.pdf", mimeType: "application/pdf", size: "4096" },
    });
    const result = await handlerFor(drive)({ fileId: "pdf2", convertOffice: false });
    const text = textOf(result);

    assert.ok(!result.isError, text);
    assert.equal(calls.copies.length, 0, "no conversion copy when conversion is disabled");
    assert.equal(calls.mediaGets.length, 0, "the PDF bytes must never be downloaded");
    assert.match(text, /binary/i);
    assert.match(text, /application\/pdf/);
  });
});

describe("drive_read_file — PDF completeness and origin notices (defect 5, found 2026-10-10)", () => {
  function pdfMock(fileId: string, bytes: Buffer, extra: Record<string, unknown> = {}) {
    return makeDriveMock({
      fileId,
      metadata: { name: `${fileId}.pdf`, mimeType: "application/pdf", size: String(bytes.length), ...extra },
      bytes,
      copyId: `tmp-${fileId}`,
      exportText: "Base imponible 1.234,56 €",
    });
  }

  it("warns at the top when the PDF is longer than the 80 pages Drive converts", async () => {
    const { drive } = pdfMock("long", pdfBytes(120));
    const text = textOf(await handlerFor(drive)({ fileId: "long" }));

    assert.match(text, /INCOMPLETE TEXT/);
    assert.match(text, /120 pages/);
    assert.match(text, /Pages 81-120 are NOT included/);
    assert.ok(text.indexOf("INCOMPLETE TEXT") < text.indexOf("---"), "the warning must come before the content");
    assert.match(text, /1\.234,56/, "the converted text is still returned");
  });

  it("confirms the page count when every page was converted", async () => {
    const { drive } = pdfMock("short", pdfBytes(80));
    const text = textOf(await handlerFor(drive)({ fileId: "short" }));

    assert.match(text, /Pages: 80 \(all converted\)/);
    assert.doesNotMatch(text, /INCOMPLETE|could not be verified|optical recognition/);
  });

  it("flags scans: the text comes from optical recognition and look-alike characters can be swapped", async () => {
    const { drive } = pdfMock("scan", pdfBytes(2, "scan"));
    const text = textOf(await handlerFor(drive)({ fileId: "scan" }));

    assert.match(text, /optical recognition/);
    assert.match(text, /O\/0/);
    assert.match(text, /verify critical figures against the original/);
  });

  it("says the page count could not be verified when the structure is unreadable", async () => {
    const { drive } = pdfMock("odd", Buffer.from("%PDF-1.7\n\x00\x01 unreadable\n", "latin1"));
    const text = textOf(await handlerFor(drive)({ fileId: "odd" }));

    assert.match(text, /Page count could not be verified/);
    assert.match(text, /first 80 pages/);
  });

  it("does not download PDFs above the inspection cap, and says the count is unverified", async () => {
    const { drive, calls } = pdfMock("huge", pdfBytes(3), { size: String(200 * 1024 * 1024) });
    const text = textOf(await handlerFor(drive)({ fileId: "huge" }));

    assert.equal(calls.mediaGets.length, 0, "a 200 MB PDF must not be downloaded for inspection");
    assert.match(text, /Page count could not be verified/);
  });

  it("explains a conversion failure in plain terms and still cleans up", async () => {
    const { drive, calls } = makeDriveMock({
      fileId: "broken",
      metadata: { name: "broken.pdf", mimeType: "application/pdf", size: "40" },
      bytes: Buffer.from("%PDF-1.4\ngarbage\n", "latin1"),
      copyId: "tmp-broken",
      exportError: makeApiError(400, "Bad Request"),
    });
    const result = await handlerFor(drive)({ fileId: "broken" });
    const text = textOf(result);

    assert.equal(result.isError, true);
    assert.match(text, /could not convert this PDF/);
    assert.match(text, /damaged, password-protected/);
    assert.match(text, /Bad Request/, "the original Drive error is kept for diagnosis");
    assert.equal(calls.deletes.length, 1);
  });
});

describe("drive_read_file — binary safety", () => {
  it("never dumps a known binary file as mojibake", async () => {
    const bytes = Buffer.concat([
      Buffer.from("PK\x03\x04"),
      Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x80, 0x81]),
    ]);
    const { drive, calls } = makeDriveMock({
      fileId: "zip1",
      metadata: { name: "archive.zip", mimeType: "application/zip", size: String(bytes.length) },
      bytes,
    });
    const result = await handlerFor(drive)({ fileId: "zip1" });
    const text = textOf(result);

    assert.ok(!result.isError, text);
    assert.equal(calls.mediaGets.length, 0, "known binary types must not be downloaded at all");
    assert.equal(calls.copies.length, 0, "non-convertible binaries must not be copied");
    assert.match(text, /binary/i, "response must say the content is binary");
    assert.match(text, /application\/zip/);
    assert.doesNotMatch(text, /�/);
  });

  it("sniffs unknown mime types and refuses to dump binary bytes", async () => {
    const bytes = Buffer.concat([
      Buffer.from("PK\x03\x04"),
      Buffer.from([0x00, 0x00, 0x9c, 0xb1, 0x00, 0x07]),
      Buffer.from("garbage"),
    ]);
    const { drive } = makeDriveMock({
      fileId: "bin1",
      metadata: { name: "blob.bin", mimeType: "application/octet-stream", size: String(bytes.length) },
      bytes,
    });
    const result = await handlerFor(drive)({ fileId: "bin1" });
    const text = textOf(result);
    assert.match(text, /binary/i);
    assert.doesNotMatch(text, /�/);
  });
});

describe("drive_read_file — Workspace exports (regression + binary formats)", () => {
  it("still exports a Google Doc as markdown by default", async () => {
    const { drive, calls } = makeDriveMock({
      fileId: "gdoc1",
      metadata: { name: "My Doc", mimeType: GDOC_MIME },
      exportText: "# Exported heading",
    });
    const result = await handlerFor(drive)({ fileId: "gdoc1" });
    const text = textOf(result);
    assert.ok(!result.isError, text);
    assert.equal(calls.exports.length, 1);
    assert.equal(calls.exports[0].mimeType, "text/markdown");
    assert.match(text, /# Exported heading/);
  });

  it("refuses binary export formats with a clear message instead of mojibake", async () => {
    const { drive, calls } = makeDriveMock({
      fileId: "gdoc2",
      metadata: { name: "My Doc", mimeType: GDOC_MIME },
    });
    const result = await handlerFor(drive)({ fileId: "gdoc2", exportFormat: "pdf" });
    const text = textOf(result);
    assert.equal(calls.exports.length, 0, "binary export must not be attempted inline");
    assert.match(text, /binary/i);
    assert.match(text, /markdown/, "message should point to the text formats available");
    assert.doesNotMatch(text, /�/);
  });
});
