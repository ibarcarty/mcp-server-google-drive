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
      /** Lets a test change what Drive reports (e.g. a new modifiedTime) between calls. */
      metadataOverride: {} as Record<string, unknown>,
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
        return { data: { id: params.fileId, ...opts.metadata, ...drive.files.metadataOverride } };
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

  it("never deletes real text when stripping images (an OCR line starting with an unclosed '[')", async () => {
    const { drive } = makeDriveMock({
      fileId: "pdf4",
      metadata: { name: "multa.pdf", mimeType: "application/pdf", size: "100" },
      exportText:
        "Pagina 1\n![][image1]\n[Nota: el plazo de recurso es de UN MES\nImporte de la sancion: 3.000,00 EUR\nNIF B12345678\n\n" +
        "[image1]: <data:image/png;base64,iVBORw0KGgo>",
    });
    const text = textOf(await handlerFor(drive)({ fileId: "pdf4" }));

    assert.match(text, /plazo de recurso es de UN MES/);
    assert.match(text, /3\.000,00 EUR/);
    assert.match(text, /NIF B12345678/);
    assert.doesNotMatch(text, /base64/);
  });

  it("returns long converted text in windows and says how to continue (review D9)", async () => {
    // Exactly 10 000 characters per page: page n starts at (n - 1) * 10 000.
    const page = (n: number) => {
      const marker = `INICIO-PAGINA-${n} `;
      return `${marker}${"x".repeat(10_000 - marker.length - 1)}\n`;
    };
    const longText = Array.from({ length: 15 }, (_, i) => page(i + 1)).join("");
    const bytes = pdfBytes(15);
    const { drive } = makeDriveMock({
      fileId: "long-text",
      metadata: { name: "contrato.pdf", mimeType: "application/pdf", size: String(bytes.length) },
      bytes,
      exportText: longText,
    });
    const first = textOf(await handlerFor(drive)({ fileId: "long-text" }));
    assert.match(first, /Pages: 15/, "the completeness line comes in every window");
    assert.match(first, /INICIO-PAGINA-1 /);
    assert.doesNotMatch(first, /INICIO-PAGINA-8 /);
    assert.match(first, new RegExp(`characters 0-59999 of ${longText.length}`));
    assert.match(first, /continue with offset=60000/);
    assert.ok(first.length < 62_000, "one window, not the whole text");

    const second = textOf(await handlerFor(drive)({ fileId: "long-text", offset: 60_000 }));
    assert.match(second, /INICIO-PAGINA-7 /);
    assert.doesNotMatch(second, /INICIO-PAGINA-1 /);
    assert.match(second, /continue with offset=120000/);
  });

  it("serves every window from ONE conversion, so windows always fit together (OCR can differ between runs)", async () => {
    const longText = "A".repeat(70_000) + "FIN";
    const bytes = pdfBytes(2);
    const { drive, calls } = makeDriveMock({
      fileId: "cached",
      metadata: { name: "c.pdf", mimeType: "application/pdf", size: String(bytes.length), modifiedTime: "2026-10-10T00:00:00Z" },
      bytes,
      exportText: longText,
    });
    const handler = handlerFor(drive);
    await handler({ fileId: "cached" });
    const second = textOf(await handler({ fileId: "cached", offset: 60_000 }));

    assert.equal(calls.copies.length, 1, "the second window must reuse the first conversion");
    assert.match(second, /FIN/);
  });

  it("converts again when the file has changed in Drive", async () => {
    const bytes = pdfBytes(1);
    const { drive, calls } = makeDriveMock({
      fileId: "changed",
      metadata: { name: "c.pdf", mimeType: "application/pdf", size: String(bytes.length), modifiedTime: "2026-10-10T00:00:00Z" },
      bytes,
      exportText: "v1",
    });
    const handler = handlerFor(drive);
    await handler({ fileId: "changed" });
    drive.files.metadataOverride = { modifiedTime: "2026-10-10T09:00:00Z" };
    await handler({ fileId: "changed" });

    assert.equal(calls.copies.length, 2);
  });

  it("strips embedded images from HTML exports too", async () => {
    const { drive } = makeDriveMock({
      fileId: "html1",
      metadata: { name: "f.pdf", mimeType: "application/pdf", size: "100" },
      exportText: `<p>Total 108,90</p><img src="data:image/png;base64,${"A".repeat(40_000)}" alt="logo"><p>Fin</p>`,
    });
    const text = textOf(await handlerFor(drive)({ fileId: "html1", exportFormat: "html" }));
    assert.match(text, /Total 108,90/);
    assert.match(text, /Fin/);
    assert.doesNotMatch(text, /base64/);
    assert.match(text, /1 embedded image\(s\) omitted/);
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

  it("states the page count is within Drive's limit, without claiming what it cannot check (review D6)", async () => {
    const { drive } = pdfMock("short", pdfBytes(80));
    const text = textOf(await handlerFor(drive)({ fileId: "short" }));

    assert.match(text, /Pages: 80 — within the 80 pages Google Drive converts\./);
    assert.doesNotMatch(text, /all converted|INCOMPLETE|could not be verified|optical recognition|no text/);
  });

  it("warns when Drive returns no text for a PDF that has pages (review D6)", async () => {
    const { drive } = makeDriveMock({
      fileId: "blank",
      metadata: { name: "blank.pdf", mimeType: "application/pdf", size: String(pdfBytes(3).length) },
      bytes: pdfBytes(3),
      copyId: "tmp-blank",
      exportText: "  \n![][image1]\n\n",
    });
    const text = textOf(await handlerFor(drive)({ fileId: "blank" }));

    assert.match(text, /Google Drive returned no text/);
  });

  it("flags scans: optical recognition can swap look-alike characters AND misread amounts (review D11)", async () => {
    const { drive } = pdfMock("scan", pdfBytes(2, "scan"));
    const text = textOf(await handlerFor(drive)({ fileId: "scan" }));

    assert.match(text, /optical recognition/);
    assert.match(text, /O\/0/);
    assert.match(text, /amounts and decimal separators/);
    assert.match(text, /occasionally drop whole pages without any error/);
    assert.match(text, /check that every page is present and verify every critical figure against the original/);
  });

  it("adds an optical-recognition note when a PDF with some typed text also carries page-sized images (review D5)", async () => {
    const content = "q 595 0 0 842 0 0 cm /Im0 Do Q BT /F1 7 Tf 40 20 Td (CSV: ABCD1234) Tj ET";
    const image = "\xFF\xD8\xFF\xD9";
    const bytes = Buffer.from(
      "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
        "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
        "3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>\nendobj\n" +
        `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n` +
        `5 0 obj\n<< /Type /XObject /Subtype /Image /Width 1240 /Height 1754 /Filter /DCTDecode /Length ${image.length} >>\nstream\n${image}\nendstream\nendobj\n` +
        "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n0\n%%EOF\n",
      "latin1",
    );
    const { drive } = pdfMock("stamped", bytes);
    const text = textOf(await handlerFor(drive)({ fileId: "stamped" }));

    assert.match(text, /page-sized images/);
    assert.match(text, /optical recognition/);
    assert.match(text, /occasionally drop whole pages without any error/);
    assert.match(text, /check that every page is present and verify every critical figure against the original/);
  });

  it("says why the count is unverified when the structure cannot be read with certainty (review D14)", async () => {
    const { drive } = pdfMock("odd", Buffer.from("%PDF-1.7\n\x00\x01 unreadable\n", "latin1"));
    const text = textOf(await handlerFor(drive)({ fileId: "odd" }));

    assert.match(text, /Page count could not be verified: its structure could not be read with certainty/);
    assert.match(text, /first 80 pages/);
  });

  it("does not download PDFs above the inspection cap, and says that is why (review D14)", async () => {
    const { drive, calls } = pdfMock("huge", pdfBytes(3), { size: String(200 * 1024 * 1024) });
    const text = textOf(await handlerFor(drive)({ fileId: "huge" }));

    assert.equal(calls.mediaGets.length, 0, "a 200 MB PDF must not be downloaded for inspection");
    assert.match(text, /Page count could not be verified: the file is larger than 50 MB/);
  });

  it("says the size is unknown when Drive reports none (review D14)", async () => {
    const { drive, calls } = pdfMock("nosize", pdfBytes(3), { size: undefined });
    const text = textOf(await handlerFor(drive)({ fileId: "nosize" }));

    assert.equal(calls.mediaGets.length, 0);
    assert.match(text, /Page count could not be verified: Drive did not report the file size/);
  });

  it("checks the export format before downloading anything (review D10)", async () => {
    const { drive, calls } = pdfMock("fmt", pdfBytes(3));
    const result = await handlerFor(drive)({ fileId: "fmt", exportFormat: "pdf" });

    assert.equal(result.isError, true);
    assert.equal(calls.mediaGets.length, 0, "no download for a request that cannot succeed");
    assert.equal(calls.copies.length, 0);
    assert.match(textOf(result), /binary/);
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
    assert.match(text, /could not convert this PDF to text/);
    assert.match(text, /Possible causes: a damaged or password-protected file, a full Drive, or Drive's 10 MB export limit/);
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
