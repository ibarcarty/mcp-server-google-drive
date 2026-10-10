// Contract tests for inspectPdf (defect 5, found 2026-10-10 in the live smoke):
// Google Drive silently converts only the first 80 pages of a PDF, so the reader
// must know the real page count to warn about incomplete text, and whether the
// PDF has a text layer (scans go through optical recognition).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { inspectPdf } from "../../src/drive/pdf-inspect.js";

type Part = string | Buffer;

const obj = (n: number, body: string): string => `${n} 0 obj\n${body}\nendobj\n`;

function streamObj(n: number, dict: string, data: Part): Buffer {
  const bytes = typeof data === "string" ? Buffer.from(data, "latin1") : data;
  return Buffer.concat([
    Buffer.from(`${n} 0 obj\n<< ${dict} /Length ${bytes.length} >>\nstream\n`, "latin1"),
    bytes,
    Buffer.from("\nendstream\nendobj\n", "latin1"),
  ]);
}

/** A compressed object stream (PDF 1.5+) holding the given objects. */
function objStm(n: number, objects: Array<[number, string]>): Buffer {
  let offset = 0;
  const header: string[] = [];
  for (const [num, body] of objects) {
    header.push(`${num} ${offset}`);
    offset += body.length + 1;
  }
  const head = `${header.join(" ")} `;
  const data = head + objects.map(([, body]) => body).join(" ");
  return streamObj(n, `/Type /ObjStm /N ${objects.length} /First ${head.length} /Filter /FlateDecode`, deflateSync(Buffer.from(data, "latin1")));
}

/** A PDF whose trailer points /Root at `root` (object 1 by default). */
function pdf(parts: Part[], root = 1, extraTrailer = ""): Buffer {
  return Buffer.concat([
    Buffer.from("%PDF-1.5\n", "latin1"),
    ...parts.map((p) => (typeof p === "string" ? Buffer.from(p, "latin1") : p)),
    Buffer.from(`trailer\n<< /Size 99 /Root ${root} 0 R ${extraTrailer}>>\nstartxref\n0\n%%EOF\n`, "latin1"),
  ]);
}

const CATALOG = obj(1, "<< /Type /Catalog /Pages 2 0 R >>");

describe("inspectPdf — page count", () => {
  it("reads the page count of the document's page tree (trailer → catalog → /Pages)", () => {
    const bytes = pdf([CATALOG, obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 3 >>"), obj(3, "<< /Type /Page /Parent 2 0 R >>")]);
    assert.equal(inspectPdf(bytes).pageCount, 3);
  });

  it("finds /Count before /Type and across nested dictionaries", () => {
    const bytes = pdf([
      CATALOG,
      obj(2, "<< /Count 120 /Resources << /ProcSet [/PDF /Text] /ExtGState << /GS1 5 0 R >> >> /Kids [3 0 R] /Type /Pages >>"),
    ]);
    assert.equal(inspectPdf(bytes).pageCount, 120);
  });

  it("ignores the /Count of bookmarks (/Outlines)", () => {
    const bytes = pdf([
      obj(1, "<< /Type /Catalog /Outlines 4 0 R /Pages 2 0 R >>"),
      obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 2 >>"),
      obj(4, "<< /Type /Outlines /Count 99 >>"),
    ]);
    assert.equal(inspectPdf(bytes).pageCount, 2);
  });

  it("ignores leftover page trees the document does not use (found in a real 'first page' extract)", () => {
    const bytes = pdf([
      CATALOG,
      obj(2, "<< /Count 1 /Kids [3 0 R] /Type /Pages >>"),
      obj(3, "<< /Type /Page /Parent 2 0 R >>"),
      obj(5, "<< /Count 14 /Kids [6 0 R 7 0 R] /Type /Pages >>"),
    ]);
    assert.equal(inspectPdf(bytes).pageCount, 1);
  });

  it("uses the latest revision after an incremental update", () => {
    const bytes = Buffer.concat([
      pdf([CATALOG, obj(2, "<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>")]),
      Buffer.from(obj(2, "<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R 6 0 R 7 0 R] /Count 5 >>"), "latin1"),
      Buffer.from("trailer\n<< /Size 99 /Root 1 0 R /Prev 9 >>\nstartxref\n0\n%%EOF\n", "latin1"),
    ]);
    assert.equal(inspectPdf(bytes).pageCount, 5);
  });

  it("resolves a catalog and page tree stored inside a compressed object stream", () => {
    const bytes = pdf([
      objStm(4, [
        [1, "<< /Type /Catalog /Pages 2 0 R >>"],
        [2, "<< /Type /Pages /Kids [3 0 R] /Count 95 >>"],
        [3, "<< /Type /Page /Parent 2 0 R >>"],
      ]),
    ]);
    assert.equal(inspectPdf(bytes).pageCount, 95);
  });

  it("finds /Root in a cross-reference stream (no classic trailer)", () => {
    const bytes = Buffer.concat([
      Buffer.from("%PDF-1.5\n", "latin1"),
      Buffer.from(CATALOG + obj(2, "<< /Type /Pages /Kids [] /Count 7 >>"), "latin1"),
      streamObj(9, "/Type /XRef /Size 10 /W [1 2 1] /Root 1 0 R", Buffer.alloc(0)),
      Buffer.from("startxref\n0\n%%EOF\n", "latin1"),
    ]);
    assert.equal(inspectPdf(bytes).pageCount, 7);
  });

  it("ignores objects inside stream data, e.g. an uncompressed PDF attachment (review D2)", () => {
    const attachment = `%PDF-1.4\n${obj(1, "<< /Type /Catalog /Pages 2 0 R >>")}${obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>")}trailer\n<< /Root 1 0 R >>\n%%EOF\n`;
    const bytes = pdf([CATALOG, obj(2, "<< /Type /Pages /Kids [] /Count 120 >>"), streamObj(9, "/Type /EmbeddedFile", attachment)]);
    assert.equal(inspectPdf(bytes).pageCount, 120);
  });

  it("is null when /Count is an indirect reference (review D4), never the object number", () => {
    const bytes = pdf([CATALOG, obj(2, "<< /Type /Pages /Kids [] /Count 7 0 R >>"), obj(7, "100")]);
    assert.equal(inspectPdf(bytes).pageCount, null);
  });

  it("is null when a later object stream cannot be decoded: it may redefine the page tree (review D1)", () => {
    const rev2 = Buffer.from(deflateSync(Buffer.from("2 0 << /Type /Pages /Kids [] /Count 100 >>", "latin1")).toString("hex"), "latin1");
    const bytes = Buffer.concat([
      pdf([CATALOG, obj(2, "<< /Type /Pages /Kids [] /Count 3 >>")]),
      streamObj(5, "/Type /ObjStm /N 1 /First 4 /Filter [/ASCIIHexDecode /FlateDecode]", rev2),
      Buffer.from("trailer\n<< /Size 99 /Root 1 0 R /Prev 9 >>\nstartxref\n0\n%%EOF\n", "latin1"),
    ]);
    assert.equal(inspectPdf(bytes).pageCount, null, "falling back to the 3-page revision would be a false confirmation");
  });

  it("reads a stream whose 'stream' keyword ends with a lone CR (tolerated by PDF readers)", () => {
    const packed = deflateSync(Buffer.from("2 0 << /Type /Pages /Kids [] /Count 100 >>", "latin1"));
    const bytes = Buffer.concat([
      pdf([CATALOG, obj(2, "<< /Type /Pages /Kids [] /Count 3 >>")]),
      Buffer.from(`5 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ${packed.length} >>\nstream\r`, "latin1"),
      packed,
      Buffer.from("\nendstream\nendobj\ntrailer\n<< /Size 99 /Root 1 0 R /Prev 9 >>\nstartxref\n0\n%%EOF\n", "latin1"),
    ]);
    assert.equal(inspectPdf(bytes).pageCount, 100);
  });

  it("a string inside the page-tree dictionary cannot fake /Count (review D14)", () => {
    const bytes = pdf([CATALOG, obj(2, "<< /Type /Pages /Title (Resumen /Count 3 \\) (nota)) /Count 120 /Kids [] >>")]);
    assert.equal(inspectPdf(bytes).pageCount, 120);
  });

  it("a '>>' inside a string does not end the dictionary", () => {
    const bytes = pdf([CATALOG, obj(2, "<< /Type /Pages /Title (a >> b << c) /Count 120 /Kids [] >>")]);
    assert.equal(inspectPdf(bytes).pageCount, 120);
  });

  it("comments are not keys: '% /Count 3' inside the dictionary is ignored", () => {
    const bytes = pdf([CATALOG, obj(2, "<< /Type /Pages % antes /Count 3\n/Count 120 /Kids [] >>")]);
    assert.equal(inspectPdf(bytes).pageCount, 120);
  });

  it("tolerates a comment between 'obj' and the dictionary", () => {
    const bytes = pdf([CATALOG, "2 0 obj % arbol de paginas\n<< /Type /Pages /Count 7 /Kids [] >>\nendobj\n"]);
    assert.equal(inspectPdf(bytes).pageCount, 7);
  });

  it("treats a page count of 0 as unverified", () => {
    const bytes = pdf([CATALOG, obj(2, "<< /Type /Pages /Kids [] /Count 0 >>")]);
    assert.equal(inspectPdf(bytes).pageCount, null);
  });

  it("is null when the document's page tree cannot be read, whatever other trees say", () => {
    const bytes = pdf([CATALOG, obj(5, "<< /Type /Pages /Kids [6 0 R] /Count 50 >>"), "2 0 obj\n<< /Type /Pages /Count 120 /Broken [ \n"]);
    assert.equal(inspectPdf(bytes).pageCount, null, "reporting the 50-page tree would falsely confirm completeness");
  });

  it("is null without a trailer /Root, even if page-tree dictionaries exist", () => {
    const bytes = Buffer.from(`%PDF-1.4\n${CATALOG}${obj(2, "<< /Type /Pages /Count 3 >>")}%%EOF\n`, "latin1");
    assert.equal(inspectPdf(bytes).pageCount, null);
  });

  it("stays fast on a hostile file full of fake stream, object and page-tree markers", () => {
    const hostile = Buffer.from(
      `%PDF-1.4\n${">>stream\nX\nendstream\n".repeat(20000)}${"/Type /Pages /Count 9 1 0 obj ".repeat(5000)}trailer << /Root 1 0 R >>`,
      "latin1",
    );
    const started = Date.now();
    const result = inspectPdf(hostile);
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 3000, `took ${elapsed} ms`);
    assert.equal(result.pageCount, null);
  });

  it("returns null when the structure cannot be read (damaged file)", () => {
    const bytes = Buffer.from("%PDF-1.4\nthis is not a pdf \x00\x01\x02 garbage\n", "latin1");
    assert.equal(inspectPdf(bytes).pageCount, null);
  });
});

describe("inspectPdf — text layer (scan detection)", () => {
  const TREE = [CATALOG, obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"), obj(3, "<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>")];

  it("is true when a page content stream shows text (BT … Tj)", () => {
    const bytes = pdf([...TREE, streamObj(4, "", "BT /F1 11 Tf 56 780 Td (Total 108,90) Tj ET")]);
    assert.equal(inspectPdf(bytes).hasTextLayer, true);
  });

  it("finds text operators in a Flate-compressed content stream", () => {
    const packed = deflateSync(Buffer.from("BT /F1 11 Tf 56 780 Td [(Fac) -20 (tura)] TJ ET", "latin1"));
    const bytes = pdf([...TREE, streamObj(4, "/Filter /FlateDecode", packed)]);
    assert.equal(inspectPdf(bytes).hasTextLayer, true);
  });

  it("reads compressed content whose /Length is an indirect reference (/Length 12 0 R)", () => {
    const packed = deflateSync(Buffer.from("q 1 0 0 1 56 28 cm BT /F1 9 Tf <0012> Tj ET Q", "latin1"));
    const bytes = pdf([
      ...TREE,
      Buffer.from("4 0 obj\n<< /Length 12 0 R /Filter /FlateDecode >>\nstream\n", "latin1"),
      packed,
      `\nendstream\nendobj\n${obj(12, String(packed.length))}`,
    ]);
    assert.equal(inspectPdf(bytes).hasTextLayer, true);
  });

  it("recognises text drawn with the ' and \" operators (review D12)", () => {
    const bytes = pdf([...TREE, streamObj(4, "", "BT /F1 11 Tf 14 TL (Linea 1) ' 0 0 (Linea 2) \" ET")]);
    assert.equal(inspectPdf(bytes).hasTextLayer, true);
  });

  it("recognises text whose BT and Tj are split across the page's content streams (review D12)", () => {
    const bytes = pdf([
      CATALOG,
      obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
      obj(3, "<< /Type /Page /Parent 2 0 R /Contents [4 0 R 5 0 R] >>"),
      streamObj(4, "", "BT /F1 11 Tf 56 780 Td"),
      streamObj(5, "", "(Total) Tj ET"),
    ]);
    assert.equal(inspectPdf(bytes).hasTextLayer, true);
  });

  it("is false for an image-only PDF (a scan), even with an unused font object", () => {
    const bytes = pdf([
      CATALOG,
      obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
      obj(3, "<< /Type /Page /Parent 2 0 R /Resources << /XObject << /Im0 5 0 R >> /Font << /F1 6 0 R >> >> /Contents 4 0 R >>"),
      streamObj(4, "", "q 595 0 0 842 0 0 cm /Im0 Do Q"),
      streamObj(5, "/Type /XObject /Subtype /Image /Width 1 /Height 1 /Filter /DCTDecode", "\xFF\xD8\xFF\xD9"),
      obj(6, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
    ]);
    assert.equal(inspectPdf(bytes).hasTextLayer, false);
  });

  it("ignores text-like bytes inside image data", () => {
    const bytes = pdf([
      ...TREE,
      streamObj(4, "", "q 595 0 0 842 0 0 cm /Im0 Do Q"),
      streamObj(5, "/Type /XObject /Subtype /Image /Width 1 /Height 1 /Filter /DCTDecode", "\xFF\xD8 BT junk (x) Tj ET \xFF\xD9"),
    ]);
    assert.equal(inspectPdf(bytes).hasTextLayer, false);
  });

  it("caps decompression (zip-bomb safe): an oversized content stream is unknown, not expanded", () => {
    const bomb = deflateSync(Buffer.concat([Buffer.alloc(70 * 1024 * 1024), Buffer.from(" BT (x) Tj ET")]));
    const result = inspectPdf(pdf([...TREE, streamObj(4, "/Filter /FlateDecode", bomb)]));
    assert.equal(result.pageCount, 1);
    assert.equal(result.hasTextLayer, null, "an unreadable content stream must not be read as 'no text'");
  });

  it("is unknown (not 'scan') when a content stream uses a filter it cannot decode", () => {
    const bytes = pdf([...TREE, streamObj(4, "/Filter /LZWDecode", "\x80\x0B\x60\x50\x22")]);
    assert.equal(inspectPdf(bytes).hasTextLayer, null);
  });

  it("is null for an encrypted PDF (its streams cannot be read), while the page count still resolves", () => {
    const bytes = pdf([CATALOG, obj(2, "<< /Type /Pages /Kids [] /Count 4 >>")], 1, "/Encrypt 9 0 R ");
    const result = inspectPdf(bytes);
    assert.equal(result.pageCount, 4);
    assert.equal(result.hasTextLayer, null);
  });

  it("is null when the structure cannot be read", () => {
    const bytes = Buffer.from("%PDF-1.4\ngarbage\n", "latin1");
    assert.equal(inspectPdf(bytes).hasTextLayer, null);
  });
});

describe("inspectPdf — page-sized images (scans that also carry some typed text, review D5)", () => {
  const TREE = [CATALOG, obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"), obj(3, "<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>")];

  it("flags a scanned page even when a typed footer gives the PDF a text layer (e.g. a CSV stamp)", () => {
    const bytes = pdf([
      ...TREE,
      streamObj(4, "", "q 595 0 0 842 0 0 cm /Im0 Do Q BT /F1 7 Tf 40 20 Td (CSV: ABCD1234 - verificable en sede) Tj ET"),
      streamObj(5, "/Type /XObject /Subtype /Image /Width 1240 /Height 1754 /Filter /DCTDecode", "\xFF\xD8\xFF\xD9"),
    ]);
    const result = inspectPdf(bytes);
    assert.equal(result.hasTextLayer, true);
    assert.equal(result.hasPageImages, true);
  });

  it("does not flag a small logo", () => {
    const bytes = pdf([
      ...TREE,
      streamObj(4, "", "q 100 0 0 7 56 800 cm /Im0 Do Q BT /F1 9 Tf 56 700 Td (Invoice) Tj ET"),
      streamObj(5, "/Type /XObject /Subtype /Image /Width 2000 /Height 145 /Filter /FlateDecode", deflateSync(Buffer.alloc(16))),
    ]);
    assert.equal(inspectPdf(bytes).hasPageImages, false);
  });
});
