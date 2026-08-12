import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DriveClient, FileMetadata } from "../types.js";
import {
  getFileMetadata,
  readFileBytes,
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
import { officeImportTarget, convertOfficeFile } from "../drive/office.js";

const inputSchema = {
  fileId: z.string().describe("The ID of the file to read."),
  exportFormat: z.enum(["markdown", "text", "html", "pdf", "csv", "tsv", "xlsx", "docx", "png", "svg"]).optional()
    .describe("Export format for Google Workspace files (and for Office files converted on read). Defaults: Docs→markdown, Sheets→csv, Slides→text. Binary formats (pdf, xlsx, docx, png) cannot be returned inline."),
  offset: z.number().int().min(0).optional()
    .describe("Byte offset to start reading from (regular files only). Use it to page through large files."),
  maxBytes: z.number().int().min(1).max(MAX_READ_BYTES).optional()
    .describe(`Maximum bytes to return per call (regular files only). Default ${DEFAULT_MAX_BYTES}, hard cap ${MAX_READ_BYTES}. Large files are never downloaded whole.`),
  convertOffice: z.boolean().optional()
    .describe("Convert Office files (.docx/.xlsx/.pptx and legacy/OpenDocument variants) to text via a temporary Google Workspace copy. Default true. Set false to skip conversion and get file info instead."),
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

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export function registerReadFileTool(server: McpServer, drive: DriveClient): void {
  server.tool(
    "drive_read_file",
    "Read the content of a file from Google Drive. Exports Google Workspace files (Docs to Markdown, Sheets to CSV, Slides to plain text), converts Office files (.docx/.xlsx/.pptx) to text via a temporary Google copy, and reads regular text files by byte ranges (offset/maxBytes) so large files never overflow the response. Binary files are reported, never dumped.",
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

        // 2. Office files: convert via temporary Google Workspace copy
        if (officeImportTarget(metadata.mimeType) && args.convertOffice !== false) {
          const result = await convertOfficeFile(drive, args.fileId, metadata.mimeType, args.exportFormat);
          const warning = result.cleanupWarning ? `${result.cleanupWarning}\n` : "";
          return ok(
            `${header}Converted from Office format via a temporary Google Workspace copy (exported as ${result.exportMime}).\n${warning}---\n${result.content}`,
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
