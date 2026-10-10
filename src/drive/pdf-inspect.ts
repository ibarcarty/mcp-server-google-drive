// Local structural inspection of a PDF (defect 5, found 2026-10-10): Google Drive
// silently converts only the first 80 pages, so the reader needs the real page
// count to warn about incomplete text, and whether the pages carry real text
// (a scan goes through optical recognition, which can confuse O/0 or l/1/I).
// No PDF library: the structure is read straight from the file bytes, including
// Flate-compressed object and content streams (PDF 1.5+).
//
// The page count follows the document's own chain, as any PDF reader does:
// trailer /Root → catalog → /Pages → /Count, using the latest revision of each
// object and never looking inside stream data (an attached PDF must not win).
// Safety rule: whenever something that could change the answer cannot be read
// (an undecodable object stream, a stream that cannot be delimited, an indirect
// /Count), the count is null ("could not be verified") — never a guess.
import { constants, inflateSync } from "node:zlib";

export interface PdfInspection {
  /** Pages of the document's page tree; null when it cannot be established for sure. */
  pageCount: number | null;
  /** false = no page draws text (a scan); null = unknown (encrypted or unreadable). */
  hasTextLayer: boolean | null;
  /** Some image is as large as a scanned page: text inside it can only come from optical recognition. */
  hasPageImages: boolean;
}

type StreamKind = "objstm" | "content" | "other";

interface PdfStream {
  /** Position of the stream in the file: later means a newer revision. */
  pos: number;
  dict: string;
  kind: StreamKind;
  /** false when the stream had to be decoded but could not be (filter, damage, caps). */
  readable: boolean;
  /** Decoded content, kept only for object streams. */
  data: string | null;
  /** The stream opens a text object (BT) / shows text (Tj, TJ, ' or "). */
  opensText: boolean;
  showsText: boolean;
}

// A few KB of crafted Flate data can inflate to gigabytes: cap each stream and the whole file.
const MAX_INFLATED_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_INFLATED_BYTES = 128 * 1024 * 1024;
// Bounds that keep hostile files (thousands of fake markers) fast. Real stream
// dictionaries are a few hundred bytes; a flat /Kids array of ~25 000 pages fits in 256 KB.
const STREAM_DICT_WINDOW = 8 * 1024;
const OBJECT_DICT_WINDOW = 256 * 1024;
const MAX_STREAMS = 50_000;

// "stream" must be followed by CRLF or LF; a lone CR is tolerated as real readers do.
const STREAM_START = />>\s*stream(?:\r\n|\r|\n)/g;
const ROOT_REF = /\/Root\s+(\d+)\s+\d+\s+R/g;
const ENCRYPTED = /\/Encrypt\s*(?:\d+\s+\d+\s+R|<<)/;
// Streams that never hold page text and are therefore never decoded: images, font
// programs, attachments, cross-reference and metadata.
const NOT_CONTENT = /\/Subtype\s*\/Image|\/Type\s*\/(?:XRef|Metadata|EmbeddedFile)|\/Length[123]\b|\/Subtype\s*\/XML/;
const OBJECT_STREAM = /\/Type\s*\/ObjStm/;
// ~A4 at 100 dpi (827 x 1169 px): smaller images are logos, icons or stamps.
const PAGE_IMAGE_PIXELS = 900_000;

const startsObjectBoundary = (text: string, j: number) =>
  text[j] === "e" && (text.startsWith("endobj", j) || text.startsWith("endstream", j));

/** Index just past the literal string opening at `i` — "(…)", nested parentheses, backslash escapes. */
function skipLiteralString(text: string, i: number, limit: number): number {
  let depth = 0;
  for (let k = i; k < limit; k++) {
    if (text[k] === "\\") k++;
    else if (text[k] === "(") depth++;
    else if (text[k] === ")" && --depth === 0) return k + 1;
  }
  return limit;
}

/** Index of the end of the line where the comment starting at `i` ends. */
function skipComment(text: string, i: number, limit: number): number {
  let k = i;
  while (k < limit && text[k] !== "\n" && text[k] !== "\r") k++;
  return k;
}

/**
 * Body of the dictionary opening at `start` (`<<`), at most `window` characters. Nesting-aware,
 * and strings "(…)" and comments "%…" are skipped, so a ">>" or "/Count" inside them changes nothing.
 */
function dictAt(text: string, start: number, window: number): string | null {
  let depth = 0;
  const limit = Math.min(text.length, start + window);
  for (let k = start + 2; k < limit - 1; k++) {
    const c = text[k];
    if (c === "(") {
      k = skipLiteralString(text, k, limit) - 1;
    } else if (c === "%") {
      k = skipComment(text, k, limit);
    } else if (c === "<" && text[k + 1] === "<") {
      depth++;
      k++;
    } else if (c === ">" && text[k + 1] === ">") {
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

/** The dictionary's own keys: nested dictionaries, strings and comments are dropped. */
function topLevel(body: string): string {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  const cut = (at: number, resume: number) => {
    if (depth === 0) parts.push(body.slice(from, at));
    from = resume;
  };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "(") {
      const end = skipLiteralString(body, i, body.length);
      cut(i, end);
      i = end - 1;
    } else if (c === "%") {
      const end = skipComment(body, i, body.length);
      cut(i, end);
      i = end - 1;
    } else if (c === "<" && body[i + 1] === "<") {
      if (depth === 0) parts.push(body.slice(from, i));
      depth++;
      i++;
    } else if (c === ">" && body[i + 1] === ">") {
      depth--;
      i++;
      if (depth === 0) from = i + 1;
    }
  }
  if (depth === 0) parts.push(body.slice(from));
  return parts.join(" ");
}

function decode(dict: string, raw: Buffer, maxOutputLength: number): string | null {
  const filter = /\/Filter\s*(\[[^\]]*\]|\/\w+)/.exec(dict)?.[1];
  if (!filter) return raw.length <= maxOutputLength ? raw.toString("latin1") : null;
  if (filter.replace(/[[\]\s]/g, "") !== "/FlateDecode") return null;
  try {
    return inflateSync(raw, { finishFlush: constants.Z_SYNC_FLUSH, maxOutputLength }).toString("latin1");
  } catch {
    return null; // encrypted, damaged, or larger than the cap (decompression bomb)
  }
}

const OPENS_TEXT = /\bBT\b/;
// Tj and TJ, plus the ' and " operators (move to next line and show), which follow an operand.
const SHOWS_TEXT = /\bT[jJ]\b|(?<=[\s)\]>])['"](?=\s|$)/;

/** Sorted positions of every "endstream", searched once instead of once per stream. */
function endstreamIndex(text: string): number[] {
  const positions: number[] = [];
  for (let at = text.indexOf("endstream"); at >= 0; at = text.indexOf("endstream", at + 9)) positions.push(at);
  return positions;
}

function firstAtOrAfter(sorted: number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo < sorted.length ? sorted[lo] : -1;
}

interface StreamScan {
  streams: PdfStream[];
  /** [start, end) of every stream's data, in file order. */
  dataRanges: Array<[number, number]>;
  /** Streams whose dictionary or extent could not be read. */
  unresolved: number;
}

function readStreams(text: string, bytes: Buffer): StreamScan {
  const scan: StreamScan = { streams: [], dataRanges: [], unresolved: 0 };
  let endstreams: number[] | null = null;
  let budget = MAX_TOTAL_INFLATED_BYTES;
  let lastDataEnd = 0;
  for (const match of text.matchAll(STREAM_START)) {
    if (match.index < lastDataEnd) continue; // a marker inside the previous stream's data
    if (scan.streams.length + scan.unresolved >= MAX_STREAMS) {
      scan.unresolved++;
      break;
    }
    const dict = dictEndingAt(text, match.index, STREAM_DICT_WINDOW);
    if (dict === null) {
      scan.unresolved++;
      continue;
    }
    const own = topLevel(dict);
    const dataStart = match.index + match[0].length;
    // \b stops the match from backtracking into a partial number ("/Length 12 0 R" is not 1).
    const length = /\/Length\s+(\d+)\b(?!\s+\d+\s+R)/.exec(own);
    endstreams ??= endstreamIndex(text);
    const dataEnd = length ? dataStart + Number(length[1]) : firstAtOrAfter(endstreams, dataStart);
    // An empty stream (/Length 0, e.g. a blank page) is valid; -1 means "no endstream found".
    if (dataEnd < dataStart || dataEnd > text.length) {
      scan.unresolved++;
      continue;
    }
    scan.dataRanges.push([dataStart, dataEnd]);
    lastDataEnd = dataEnd;

    const kind: StreamKind = OBJECT_STREAM.test(own) ? "objstm" : NOT_CONTENT.test(own) ? "other" : "content";
    if (kind === "other") {
      scan.streams.push({ pos: match.index, dict: own, kind, readable: true, data: null, opensText: false, showsText: false });
      continue;
    }
    const decoded = budget > 0 ? decode(own, bytes.subarray(dataStart, dataEnd), Math.min(MAX_INFLATED_BYTES, budget)) : null;
    if (decoded !== null) budget -= decoded.length;
    scan.streams.push({
      pos: match.index,
      dict: own,
      kind,
      readable: decoded !== null,
      data: kind === "objstm" ? decoded : null,
      opensText: kind === "content" && decoded !== null && OPENS_TEXT.test(decoded),
      showsText: kind === "content" && decoded !== null && SHOWS_TEXT.test(decoded),
    });
  }
  return scan;
}

function insideStreamData(ranges: Array<[number, number]>, pos: number): boolean {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pos < ranges[mid][0]) hi = mid - 1;
    else if (pos >= ranges[mid][1]) lo = mid + 1;
    else return true;
  }
  return false;
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
function latestObjectDict(num: number, raw: string, scan: StreamScan): string | null {
  let best: { pos: number; text: string; start: number } | null = null;
  for (const m of raw.matchAll(new RegExp(`(?<![0-9])${num}\\s+\\d+\\s+obj\\b`, "g"))) {
    if (!insideStreamData(scan.dataRanges, m.index)) best = { pos: m.index, text: raw, start: m.index + m[0].length };
  }
  for (const s of scan.streams) {
    if (s.kind !== "objstm" || (best && s.pos < best.pos)) continue;
    const offset = offsetInObjectStream(s, num);
    if (offset !== null && s.data !== null) best = { pos: s.pos, text: s.data, start: offset };
  }
  if (!best) return null;
  const open = best.text.indexOf("<<", best.start);
  // Only whitespace and comments may sit between "obj" and the dictionary.
  if (open < 0 || best.text.slice(best.start, open).replace(/%[^\r\n]*/g, "").trim() !== "") return null;
  const dict = dictAt(best.text, open, OBJECT_DICT_WINDOW);
  return dict === null ? null : topLevel(dict);
}

function documentPageCount(raw: string, scan: StreamScan): number | null {
  // Anything unreadable could hold a newer revision of the page tree.
  if (scan.unresolved > 0 || scan.streams.some((s) => s.kind === "objstm" && !s.readable)) return null;
  const roots = [...raw.matchAll(ROOT_REF)].filter((m) => !insideStreamData(scan.dataRanges, m.index));
  if (roots.length === 0) return null;
  const catalog = latestObjectDict(Number(roots[roots.length - 1][1]), raw, scan);
  const pagesRef = catalog && /\/Pages\s+(\d+)\s+\d+\s+R/.exec(catalog);
  const pages = pagesRef && latestObjectDict(Number(pagesRef[1]), raw, scan);
  if (!pages || !/\/Type\s*\/Pages(?![A-Za-z])/.test(pages)) return null;
  // A direct integer only: "/Count 7 0 R" is a reference, not 7 pages.
  const count = /\/Count\s+(\d+)\b(?!\s+\d+\s+R)/.exec(pages);
  const value = count ? Number(count[1]) : 0;
  return value > 0 ? value : null;
}

function isPageSizedImage(stream: PdfStream): boolean {
  if (!/\/Subtype\s*\/Image/.test(stream.dict)) return false;
  const width = Number(/\/Width\s+(\d+)/.exec(stream.dict)?.[1] ?? 0);
  const height = Number(/\/Height\s+(\d+)/.exec(stream.dict)?.[1] ?? 0);
  return width * height >= PAGE_IMAGE_PIXELS;
}

export function inspectPdf(bytes: Buffer): PdfInspection {
  const raw = bytes.toString("latin1");
  const scan = readStreams(raw, bytes);
  const pageCount = documentPageCount(raw, scan);

  let hasTextLayer: boolean | null;
  if (ENCRYPTED.test(raw)) hasTextLayer = null;
  // A page may split its text object across several content streams, so look at them together.
  else if (scan.streams.some((s) => s.opensText) && scan.streams.some((s) => s.showsText)) hasTextLayer = true;
  // An unreadable stream might hold the text: "unknown", never "scan".
  else if (pageCount === null || scan.unresolved > 0 || scan.streams.some((s) => s.kind === "content" && !s.readable)) hasTextLayer = null;
  else hasTextLayer = false;

  return { pageCount, hasTextLayer, hasPageImages: scan.streams.some(isPageSizedImage) };
}
