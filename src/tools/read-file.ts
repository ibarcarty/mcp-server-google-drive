import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DriveClient, FileMetadata } from "../types.js";
import {
  getFileMetadata,
  readFileBytes,
  downloadWholeFile,
  DEFAULT_MAX_BYTES,
  MAX_READ_BYTES,
} from "../drive/files.js";
import {
  isWorkspaceFile,
  resolveExportMimeType,
  exportWorkspaceFile,
  getAvailableFormats,
} from "../drive/export.js";
import { isTextualMime, isKnownBinaryMime, looksBinary } from "../drive/content-type.js";
import { officeImportTarget, convertOfficeFile, conversionExportMime, DRIVE_PDF_PAGE_LIMIT } from "../drive/office.js";
import { inspectPdf, type PdfInspection } from "../drive/pdf-inspect.js";

const PDF_MIME = "application/pdf";
// PDFs above this size are not downloaded for inspection (the count is reported as unverified).
const MAX_PDF_INSPECT_BYTES = 50 * 1024 * 1024;
// Converted Office/PDF text is returned in windows of this many characters (long contracts
// would otherwise exceed what an MCP client accepts in one response).
const CONVERTED_WINDOW_CHARS = 60_000;
// Windows of one document must come from ONE conversion: Drive's text recognition can return
// different text on different runs, and offsets into different texts would skip or repeat text.
const CONVERSION_CACHE_TTL_MS = 10 * 60 * 1000;
const CONVERSION_CACHE_MAX_ENTRIES = 8;
const UNKNOWN_PDF: PdfInspection = { pageCount: null, hasTextLayer: null, hasPageImages: false };

const inputSchema = {
  fileId: z.string().describe("The ID of the file to read."),
  exportFormat: z.enum(["markdown", "text", "html", "pdf", "csv", "tsv", "xlsx", "docx", "png", "svg"]).optional()
    .describe("Export format for Google Workspace files (and for Office files converted on read). Defaults: Docs→markdown, Sheets→csv, Slides→text. Binary formats (pdf, xlsx, docx, png) cannot be returned inline."),
  offset: z.number().int().min(0).optional()
    .describe("Where to start reading: a byte offset for regular files, a character offset in the converted text for Office files and PDFs. Use it to page through large files."),
  maxBytes: z.number().int().min(1).max(MAX_READ_BYTES).optional()
    .describe(`Maximum bytes (regular files; default ${DEFAULT_MAX_BYTES}) or characters of converted text (Office files and PDFs; default ${CONVERTED_WINDOW_CHARS}) to return per call. Hard cap ${MAX_READ_BYTES}.`),
  convertOffice: z.boolean().optional()
    .describe("Convert Office files (.docx/.xlsx/.pptx and legacy/OpenDocument variants) and PDFs to text via a temporary Google Workspace copy (PDFs go through Drive text recognition). Default true. Set false to skip conversion and get file info instead."),
};

function baseHeader(metadata: FileMetadata): string {
  const size = metadata.size !== undefined ? `Size: ${metadata.size} bytes\n` : "";
  return `File: ${metadata.name}\nMIME: ${metadata.mimeType}\nID: ${metadata.id}\n${size}`;
}

function binaryNotice(metadata: FileMetadata, detail: string): string {
  const link = metadata.webViewLink ? `\nOpen in Drive: ${metadata.webViewLink}` : "";
  return (
    `${baseHeader(metadata)}---\n` +
    `Binary content — not rendered as text (${detail}). ` +
    `Decoding it inline would produce lossy mojibake. ` +
    `Use drive_get_file_info for metadata, or download it from Drive.${link}`
  );
}

interface PdfCheck {
  inspection: PdfInspection;
  /** Why the page count could not be established, in words for the reader. */
  unverifiedReason?: string;
}

async function inspectDrivePdf(drive: DriveClient, metadata: FileMetadata): Promise<PdfCheck> {
  const size = metadata.size === undefined || metadata.size === null || metadata.size === "" ? Number.NaN : Number(metadata.size);
  if (!Number.isFinite(size)) return { inspection: UNKNOWN_PDF, unverifiedReason: "Drive did not report the file size" };
  if (size > MAX_PDF_INSPECT_BYTES) {
    return { inspection: UNKNOWN_PDF, unverifiedReason: `the file is larger than ${MAX_PDF_INSPECT_BYTES / 1024 / 1024} MB` };
  }
  let bytes: Buffer;
  try {
    bytes = await downloadWholeFile(drive, metadata.id);
  } catch {
    return { inspection: UNKNOWN_PDF, unverifiedReason: "the file could not be downloaded for inspection" };
  }
  const inspection = inspectPdf(bytes);
  return inspection.pageCount === null
    ? { inspection, unverifiedReason: "its structure could not be read with certainty (encrypted, damaged or unusual file)" }
    : { inspection };
}

// Measured 2026-10-10: Drive's recognition swapped look-alikes in codes ("0O8B 1l7I" -> "008B 1171")
// and, in 1 of 7 runs of the same 6-page scan, returned only pages 3, 5 and 6 with no error.
const OCR_RISKS =
  "It can swap look-alike characters in codes (O/0, l/1/I, S/5), misread amounts and decimal separators, " +
  "and occasionally drop whole pages without any error: check that every page is present and verify every " +
  "critical figure against the original.";

/** True when the converted text has no words at all (only whitespace, image references or the omission note). */
function hasNoText(content: string): boolean {
  return content
    .replace(/!\[[^\]\n]*\]\[[^\]\n]*\]/g, "")
    .replace(/\(\d+ embedded image\(s\) omitted\)/g, "")
    .trim().length === 0;
}

/** Completeness and origin notices shown BEFORE the converted text of a PDF. */
function pdfNotices({ inspection, unverifiedReason }: PdfCheck, content: string): string {
  const { pageCount, hasTextLayer, hasPageImages } = inspection;
  const lines: string[] = [];
  if (pageCount === null) {
    lines.push(
      `⚠ Page count could not be verified: ${unverifiedReason ?? "unknown reason"}. ` +
      `Google Drive converts only the first ${DRIVE_PDF_PAGE_LIMIT} pages: if this PDF is longer, the text below is incomplete.`,
    );
  } else if (pageCount > DRIVE_PDF_PAGE_LIMIT) {
    lines.push(
      `⚠ INCOMPLETE TEXT: this PDF has ${pageCount} pages but Google Drive converts only the first ${DRIVE_PDF_PAGE_LIMIT}. ` +
      `Pages ${DRIVE_PDF_PAGE_LIMIT + 1}-${pageCount} are NOT included below.`,
    );
  } else {
    lines.push(`Pages: ${pageCount} — within the ${DRIVE_PDF_PAGE_LIMIT} pages Google Drive converts.`);
  }
  if (hasNoText(content)) {
    lines.push("⚠ Google Drive returned no text for this PDF (blank, or images that text recognition could not read).");
  }
  if (hasTextLayer === false) {
    lines.push(
      `Note: no page of this PDF carries a text layer (scanned image), so the text comes from optical recognition. ${OCR_RISKS}`,
    );
  } else if (hasTextLayer === true && hasPageImages) {
    lines.push(
      "Note: this PDF also contains page-sized images (scanned pages, stamps or photos). Any text inside them comes from " +
      `optical recognition. ${OCR_RISKS}`,
    );
  } else if (hasTextLayer === null) {
    lines.push("Note: could not check whether this PDF has a text layer; if it is a scan, verify every critical figure against the original.");
  }
  return `${lines.join("\n")}\n`;
}

interface CachedConversion {
  at: number;
  content: string;
  exportMime: string;
  notices: string;
  cleanupWarning?: string;
}

/** Small in-memory cache, keyed by file, revision and export format. */
class ConversionCache {
  private readonly entries = new Map<string, CachedConversion>();

  key(metadata: FileMetadata, exportFormat?: string): string | null {
    // Without a revision stamp a changed file could be served stale: do not cache.
    return metadata.modifiedTime ? `${metadata.id}|${metadata.modifiedTime}|${exportFormat ?? ""}` : null;
  }

  get(key: string | null): CachedConversion | undefined {
    if (!key) return undefined;
    const hit = this.entries.get(key);
    if (hit && Date.now() - hit.at > CONVERSION_CACHE_TTL_MS) {
      this.entries.delete(key);
      return undefined;
    }
    return hit;
  }

  set(key: string | null, value: CachedConversion): void {
    if (!key) return;
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > CONVERSION_CACHE_MAX_ENTRIES) {
      this.entries.delete(this.entries.keys().next().value as string);
    }
  }
}

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export function registerReadFileTool(server: McpServer, drive: DriveClient): void {
  const conversions = new ConversionCache();
  server.tool(
    "drive_read_file",
    "Read the content of a file from Google Drive. Exports Google Workspace files (Docs to Markdown, Sheets to CSV, Slides to plain text), converts Office files (.docx/.xlsx/.pptx) and PDFs to text via a temporary Google copy, and reads regular text files by byte ranges (offset/maxBytes) so large files never overflow the response. Binary files are reported, never dumped.",
    inputSchema,
    async (args) => {
      try {
        const metadata = await getFileMetadata(drive, args.fileId);
        const header = baseHeader(metadata);

        // 1. Google Workspace files: export (text formats only inline)
        if (isWorkspaceFile(metadata.mimeType)) {
          const exportMime = resolveExportMimeType(metadata.mimeType, args.exportFormat);
          const formats = getAvailableFormats(metadata.mimeType);
          if (!isTextualMime(exportMime)) {
            const textFormats = formats.filter((f) =>
              isTextualMime(resolveExportMimeType(metadata.mimeType, f)),
            );
            return ok(
              `${header}---\n` +
              `The "${args.exportFormat ?? "default"}" export of this file is a binary format (${exportMime}) and cannot be returned inline. ` +
              `Available text formats: ${textFormats.join(", ") || "none"}.` +
              (metadata.webViewLink ? `\nTo obtain the binary, download it from Drive: ${metadata.webViewLink}` : ""),
            );
          }
          const content = await exportWorkspaceFile(drive, args.fileId, exportMime);
          return ok(
            `${header}Export format: ${args.exportFormat ?? "default"} (${exportMime})\nAvailable formats: ${formats.join(", ")}\n---\n${content}`,
          );
        }

        // 2. Office files and PDFs: convert via temporary Google Workspace copy
        if (officeImportTarget(metadata.mimeType) && args.convertOffice !== false) {
          const isPdf = metadata.mimeType.toLowerCase() === PDF_MIME;
          conversionExportMime(metadata.mimeType, args.exportFormat); // fail fast, before any download or copy
          const cacheKey = conversions.key(metadata, args.exportFormat);
          let result = conversions.get(cacheKey);
          if (!result) {
            let converted;
            try {
              converted = await convertOfficeFile(drive, args.fileId, metadata.mimeType, args.exportFormat);
            } catch (error) {
              if (!isPdf) throw error;
              const reason = error instanceof Error ? error.message : String(error);
              throw new Error(
                `Google Drive could not convert this PDF to text (Drive said: ${reason}). ` +
                "Possible causes: a damaged or password-protected file, a full Drive, or Drive's 10 MB export limit.",
              );
            }
            const notices = isPdf ? pdfNotices(await inspectDrivePdf(drive, metadata), converted.content) : "";
            result = { at: Date.now(), content: converted.content, exportMime: converted.exportMime, notices, cleanupWarning: converted.cleanupWarning };
            conversions.set(cacheKey, result);
          }
          const notices = result.notices;
          const warning = result.cleanupWarning ? `${result.cleanupWarning}\n` : "";
          const source = isPdf ? "PDF (Drive text recognition)" : "Office format";
          const total = result.content.length;
          const start = Math.min(args.offset ?? 0, total);
          const end = Math.min(total, start + (args.maxBytes ?? CONVERTED_WINDOW_CHARS));
          const windowLine = start > 0 || end < total
            ? `Text window: characters ${start}-${Math.max(start, end - 1)} of ${total}${end < total ? ` (truncated; continue with offset=${end})` : ""}\n`
            : "";
          return ok(
            `${header}Converted from ${source} via a temporary Google Workspace copy (exported as ${result.exportMime}).\n` +
            `${notices}${warning}${windowLine}---\n${result.content.slice(start, end)}`,
          );
        }

        // 3. Known binary types: report, never download
        if (isKnownBinaryMime(metadata.mimeType)) {
          return ok(binaryNotice(metadata, metadata.mimeType));
        }

        // 4. Regular files: ranged read, never the whole file
        const offset = args.offset ?? 0;
        const maxBytes = args.maxBytes ?? DEFAULT_MAX_BYTES;
        const buffer = await readFileBytes(drive, args.fileId, { offset, maxBytes });

        if (!isTextualMime(metadata.mimeType) && looksBinary(buffer)) {
          return ok(binaryNotice(metadata, `${metadata.mimeType}, content sniffed as binary`));
        }

        const totalSize = metadata.size !== undefined ? Number(metadata.size) : Number.NaN;
        const endExclusive = offset + buffer.length;
        const truncated = Number.isFinite(totalSize)
          ? endExclusive < totalSize
          : buffer.length >= maxBytes;

        let rangeLine = "";
        if (offset > 0 || truncated) {
          const total = Number.isFinite(totalSize) ? ` of ${totalSize}` : "";
          rangeLine = `Range: bytes ${offset}-${Math.max(offset, endExclusive - 1)}${total}`;
          if (truncated) {
            const remaining = Number.isFinite(totalSize) ? `${totalSize - endExclusive} bytes remain — ` : "";
            rangeLine += ` (truncated; ${remaining}continue with offset=${endExclusive})`;
          }
          rangeLine += "\n";
        }

        return ok(`${header}${rangeLine}---\n${buffer.toString("utf8")}`);
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error reading file: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
}
