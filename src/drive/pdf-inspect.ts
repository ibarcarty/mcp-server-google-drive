// Local structural inspection of a PDF (defect 5, found 2026-10-10): Google Drive
// silently converts only the first 80 pages, so the reader needs the real page
// count to warn about incomplete text, and whether the pages carry real text
// (a scan goes through optical recognition, which can confuse O/0 or l/1/I).
// No PDF library: the structure is read straight from the file bytes, including
// Flate-compressed object and content streams (PDF 1.5+).
//
// The page count follows the document's own chain, as any PDF reader does:
// trailer /Root → catalog → /Pages → /Count, using the latest revision of each
// object. Leftover page trees inside the file are ignored (a real "first page"
// extract carried the full 14-page tree of its source article). Anything that
// cannot be followed returns null ("could not be verified"), never a guess.
import { constants, inflateSync } from "node:zlib";

export interface PdfInspection {
  /** Pages of the document's page tree; null when the chain cannot be followed. */
  pageCount: number | null;
  /** false = no page draws text (a scan); null = unknown (encrypted or unreadable). */
  hasTextLayer: boolean | null;
}

interface PdfStream {
  /** Position of the stream in the file: later means a newer revision. */
  pos: number;
  dict: string;
  /** Decoded bytes (latin1); null when the filter is not Flate or decoding failed. */
  data: string | null;
}

// A few KB of crafted Flate data can inflate to gigabytes: never expand a stream beyond this.
const MAX_INFLATED_BYTES = 32 * 1024 * 1024;
// Bounds that keep hostile files (thousands of fake markers) fast. Real stream
// dictionaries are a few hundred bytes; a flat /Kids array of ~25 000 pages fits in 256 KB.
const STREAM_DICT_WINDOW = 8 * 1024;
const OBJECT_DICT_WINDOW = 256 * 1024;
const MAX_STREAMS = 50_000;

const STREAM_START = />>\s*stream\r?\n/g;
const ROOT_REF = /\/Root\s+(\d+)\s+\d+\s+R/g;
const ENCRYPTED = /\/Encrypt\s*(?:\d+\s+\d+\s+R|<<)/;
// Streams that never hold page text: images, font programs, object streams, cross-reference and metadata.
const NOT_CONTENT = /\/Subtype\s*\/Image|\/Type\s*\/(?:XRef|Metadata|ObjStm)|\/Length[123]\b|\/Subtype\s*\/XML/;

const startsObjectBoundary = (text: string, j: number) =>
  text[j] === "e" && (text.startsWith("endobj", j) || text.startsWith("endstream", j));

/** Body of the dictionary opening at `start` (`<<`), nesting-aware, at most `window` characters. */
function dictAt(text: string, start: number, window: number): string | null {
  let depth = 0;
  const limit = Math.min(text.length - 1, start + window);
  for (let k = start + 2; k < limit; k++) {
    if (text[k] === "<" && text[k + 1] === "<") {
      depth++;
      k++;
    } else if (text[k] === ">" && text[k + 1] === ">") {
      if (depth === 0) return text.slice(start + 2, k);
      depth--;
      k++;
    }
  }
  return null;
}

/** Body of the dictionary whose closing `>>` starts at `close`, never looking across another object. */
function dictEndingAt(text: string, close: number, window: number): string | null {
  let depth = 0;
  for (let j = close - 2; j >= Math.max(0, close - window); j--) {
    if (startsObjectBoundary(text, j)) return null;
    if (text[j] === ">" && text[j + 1] === ">") {
      depth++;
      j--;
    } else if (text[j] === "<" && text[j + 1] === "<") {
      if (depth === 0) return dictAt(text, j, window);
      depth--;
      j--;
    }
  }
  return null;
}

/** Drops nested dictionaries so only the dictionary's own keys remain. */
function topLevel(body: string): string {
  let out = "";
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const pair = body.slice(i, i + 2);
    if (pair === "<<") {
      depth++;
      i++;
    } else if (pair === ">>") {
      depth--;
      i++;
    } else if (depth === 0) {
      out += body[i];
    }
  }
  return out;
}

function decode(dict: string, raw: Buffer): string | null {
  const filter = /\/Filter\s*(\[[^\]]*\]|\/\w+)/.exec(dict)?.[1];
  if (!filter) return raw.toString("latin1");
  if (filter.replace(/[[\]\s]/g, "") !== "/FlateDecode") return null;
  try {
    return inflateSync(raw, { finishFlush: constants.Z_SYNC_FLUSH, maxOutputLength: MAX_INFLATED_BYTES }).toString("latin1");
  } catch {
    return null; // encrypted, damaged, or larger than the cap (decompression bomb)
  }
}

/** Every stream with its decoded data; `unresolved` counts streams whose dictionary could not be read. */
function readStreams(text: string, bytes: Buffer): { streams: PdfStream[]; unresolved: number } {
  const streams: PdfStream[] = [];
  let unresolved = 0;
  for (const match of text.matchAll(STREAM_START)) {
    if (streams.length + unresolved >= MAX_STREAMS) {
      unresolved++;
      break;
    }
    const dict = dictEndingAt(text, match.index, STREAM_DICT_WINDOW);
    if (dict === null) {
      unresolved++;
      continue;
    }
    const own = topLevel(dict);
    const dataStart = match.index + match[0].length;
    // \b stops the match from backtracking into a partial number ("/Length 12 0 R" is not 1).
    const length = /\/Length\s+(\d+)\b(?!\s+\d+\s+R)/.exec(own);
    const dataEnd = length ? dataStart + Number(length[1]) : text.indexOf("endstream", dataStart);
    if (dataEnd <= dataStart) {
      unresolved++;
      continue;
    }
    streams.push({ pos: match.index, dict: own, data: decode(own, bytes.subarray(dataStart, dataEnd)) });
  }
  return { streams, unresolved };
}

/** Offset of object `num` inside a decoded object stream, or null if it is not there. */
function offsetInObjectStream(stream: PdfStream, num: number): number | null {
  if (stream.data === null) return null;
  const first = Number(/\/First\s+(\d+)/.exec(stream.dict)?.[1]);
  if (!Number.isFinite(first)) return null;
  const header = stream.data.slice(0, first).trim().split(/\s+/).map(Number);
  for (let i = 0; i + 1 < header.length; i += 2) {
    if (header[i] === num) return first + header[i + 1];
  }
  return null;
}

/** Own keys of the latest definition of object `num` (raw or in an object stream); null if unreadable. */
function latestObjectDict(num: number, raw: string, objectStreams: PdfStream[]): string | null {
  let best: { pos: number; text: string; start: number } | null = null;
  for (const m of raw.matchAll(new RegExp(`(?<![0-9])${num}\\s+\\d+\\s+obj\\b`, "g"))) {
    best = { pos: m.index, text: raw, start: m.index + m[0].length };
  }
  for (const s of objectStreams) {
    if (best && s.pos < best.pos) continue;
    const offset = offsetInObjectStream(s, num);
    if (offset !== null && s.data !== null) best = { pos: s.pos, text: s.data, start: offset };
  }
  if (!best) return null;
  const open = best.text.indexOf("<<", best.start);
  if (open < 0 || best.text.slice(best.start, open).trim() !== "") return null;
  const dict = dictAt(best.text, open, OBJECT_DICT_WINDOW);
  return dict === null ? null : topLevel(dict);
}

function documentPageCount(raw: string, objectStreams: PdfStream[]): number | null {
  const roots = [...raw.matchAll(ROOT_REF)];
  if (roots.length === 0) return null;
  const catalog = latestObjectDict(Number(roots[roots.length - 1][1]), raw, objectStreams);
  const pagesRef = catalog && /\/Pages\s+(\d+)\s+\d+\s+R/.exec(catalog);
  const pages = pagesRef && latestObjectDict(Number(pagesRef[1]), raw, objectStreams);
  if (!pages || !/\/Type\s*\/Pages(?![A-Za-z])/.test(pages)) return null;
  const count = /\/Count\s+(\d+)/.exec(pages);
  return count ? Number(count[1]) : null;
}

function drawsText(content: string): boolean {
  return /\bBT\b/.test(content) && /\bT[jJ]\b/.test(content);
}

export function inspectPdf(bytes: Buffer): PdfInspection {
  const raw = bytes.toString("latin1");
  const { streams, unresolved } = readStreams(raw, bytes);
  const objectStreams = streams.filter((s) => /\/Type\s*\/ObjStm/.test(s.dict));
  const pageCount = documentPageCount(raw, objectStreams);

  const content = streams.filter((s) => !NOT_CONTENT.test(s.dict));
  let hasTextLayer: boolean | null;
  if (ENCRYPTED.test(raw)) hasTextLayer = null;
  else if (content.some((s) => s.data !== null && drawsText(s.data))) hasTextLayer = true;
  // An unreadable stream might hold the text: "unknown", never "scan".
  else if (pageCount === null || unresolved > 0 || content.some((s) => s.data === null)) hasTextLayer = null;
  else hasTextLayer = false;

  return { pageCount, hasTextLayer };
}
