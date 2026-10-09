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
import { officeImportTarget, convertOfficeFile, DRIVE_PDF_PAGE_LIMIT } from "../drive/office.js";
import { inspectPdf, type PdfInspection } from "../drive/pdf-inspect.js";

const PDF_MIME = "application/pdf";
// PDFs above this size are not downloaded for inspection (the count is reported as unverified).
const MAX_PDF_INSPECT_BYTES = 50 * 1024 * 1024;
const UNKNOWN_PDF: PdfInspection = { pageCount: null, hasTextLayer: null };

const inputSchema = {
  fileId: z.string().describe("The ID of the file to read."),
  exportFormat: z.enum(["markdown", "text", "html", "pdf", "csv", "tsv", "xlsx", "docx", "png", "svg"]).optional()
    .describe("Export format for Google Workspace files (and for Office files converted on read). Defaults: Docs→markdown, Sheets→csv, Slides→text. Binary formats (pdf, xlsx, docx, png) cannot be returned inline."),
  offset: z.number().int().min(0).optional()
    .describe("Byte offset to start reading from (regular files only). Use it to page through large files."),
  maxBytes: z.number().int().min(1).max(MAX_READ_BYTES).optional()
    .describe(`Maximum bytes to return per call (regular files only). Default ${DEFAULT_MAX_BYTES}, hard cap ${MAX_READ_BYTES}. Large files are never downloaded whole.`),
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

async function inspectDrivePdf(drive: DriveClient, metadata: FileMetadata): Promise<PdfInspection> {
  const size = Number(metadata.size);
  if (!Number.isFinite(size) || size > MAX_PDF_INSPECT_BYTES) return UNKNOWN_PDF;
  try {
    return inspectPdf(await downloadWholeFile(drive, metadata.id));
  } catch {
    return UNKNOWN_PDF;
  }
}

/** Completeness and origin notices shown BEFORE the converted text of a PDF. */
function pdfNotices({ pageCount, hasTextLayer }: PdfInspection): string {
  const lines: string[] = [];
  if (pageCount === null) {
    lines.push(
      `⚠ Page count could not be verified (encrypted, unusual structure or larger than ${MAX_PDF_INSPECT_BYTES / 1024 / 1024} MB). ` +
      `Google Drive converts only the first ${DRIVE_PDF_PAGE_LIMIT} pages: if this PDF is longer, the text below is incomplete.`,
    );
  } else if (pageCount > DRIVE_PDF_PAGE_LIMIT) {
    lines.push(
      `⚠ INCOMPLETE TEXT: this PDF has ${pageCount} pages but Google Drive converts only the first ${DRIVE_PDF_PAGE_LIMIT}. ` +
      `Pages ${DRIVE_PDF_PAGE_LIMIT + 1}-${pageCount} are NOT included below.`,
    );
  } else {
    lines.push(`Pages: ${pageCount} (all converted).`);
  }
  if (hasTextLayer === false) {
    lines.push(
      "Note: no page of this PDF carries a text layer (scanned image), so the text comes from optical recognition. " +
      "Digits are usually exact, but look-alike characters in codes (O/0, l/1/I, S/5) can be swapped: verify critical figures against the original.",
    );
  } else if (hasTextLayer === null) {
    lines.push("Note: could not check whether this PDF has a text layer; if it is a scan, verify critical figures against the original.");
  }
  return `${lines.join("\n")}\n`;
}

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export function registerReadFileTool(server: McpServer, drive: DriveClient): void {
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
          const inspection = isPdf ? await inspectDrivePdf(drive, metadata) : null;
          let result;
          try {
            result = await convertOfficeFile(drive, args.fileId, metadata.mimeType, args.exportFormat);
          } catch (error) {
            if (!isPdf) throw error;
            const reason = error instanceof Error ? error.message : String(error);
            throw new Error(
              `Google Drive could not convert this PDF to text: it may be damaged, password-protected or not a real PDF (Drive said: ${reason}).`,
            );
          }
          const notices = inspection ? pdfNotices(inspection) : "";
          const warning = result.cleanupWarning ? `${result.cleanupWarning}\n` : "";
          const source = isPdf ? "PDF (Drive text recognition)" : "Office format";
          return ok(
            `${header}Converted from ${source} via a temporary Google Workspace copy (exported as ${result.exportMime}).\n${notices}${warning}---\n${result.content}`,
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
