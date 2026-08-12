// Helpers to decide whether content can be safely rendered as text.
// Binary bytes decoded as UTF-8 produce irreversible U+FFFD mojibake, so the
// server must classify before rendering (defect 3, verified 2026-08-12).

const TEXTUAL_EXACT = new Set([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/typescript",
  "application/x-sh",
  "application/x-httpd-php",
  "application/x-yaml",
  "application/yaml",
  "application/rtf",
  "application/x-ndjson",
  "application/sql",
  "image/svg+xml",
]);

const BINARY_EXACT = new Set([
  "application/pdf",
  "application/zip",
  "application/gzip",
  "application/x-tar",
  "application/x-7z-compressed",
  "application/x-rar-compressed",
  "application/vnd.rar",
  "application/x-msdownload",
  "application/x-iso9660-image",
  "application/epub+zip",
]);

const BINARY_PREFIXES = ["image/", "audio/", "video/", "font/", "model/"];

export function isTextualMime(mimeType: string): boolean {
  const mime = mimeType.toLowerCase();
  if (mime.startsWith("text/")) return true;
  if (TEXTUAL_EXACT.has(mime)) return true;
  return /\+(json|xml)$/.test(mime);
}

/** Types we refuse to download at all — they can never render as text. */
export function isKnownBinaryMime(mimeType: string): boolean {
  const mime = mimeType.toLowerCase();
  if (isTextualMime(mime)) return false;
  if (BINARY_EXACT.has(mime)) return true;
  return BINARY_PREFIXES.some((p) => mime.startsWith(p));
}

/**
 * Trims up to 3 trailing bytes when they form an incomplete UTF-8 sequence,
 * so that a byte-range slice does not misclassify text as binary.
 */
function trimIncompleteUtf8Tail(buf: Buffer): Buffer {
  let end = buf.length;
  for (let i = 1; i <= 3 && end - i >= 0; i++) {
    const b = buf[end - i];
    if ((b & 0b1100_0000) === 0b1000_0000) continue; // continuation byte — keep scanning back
    const needed = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : b >= 0xc0 ? 2 : 1;
    if (needed > i) end -= i; // lead byte with its sequence cut off — drop the tail
    break;
  }
  return buf.subarray(0, end);
}

/** Content sniff for ambiguous mime types (e.g. application/octet-stream). */
export function looksBinary(buf: Buffer): boolean {
  const sample = buf.subarray(0, 8192);
  if (sample.includes(0)) return true;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(trimIncompleteUtf8Tail(sample));
    return false;
  } catch {
    return true;
  }
}
