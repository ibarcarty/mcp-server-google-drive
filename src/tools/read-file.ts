import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DriveClient } from "../types.js";
import { getFileMetadata, readFileContent } from "../drive/files.js";
import { isWorkspaceFile, resolveExportMimeType, exportWorkspaceFile, getAvailableFormats } from "../drive/export.js";

const inputSchema = {
  fileId: z.string().describe("The ID of the file to read."),
  exportFormat: z.enum(["markdown", "text", "html", "pdf", "csv", "tsv", "xlsx", "docx", "png", "svg"]).optional()
    .describe("Export format for Google Workspace files. Defaults: Docs→markdown, Sheets→csv, Slides→text. Ignored for non-Workspace files."),
};

export function registerReadFileTool(server: McpServer, drive: DriveClient): void {
  server.tool(
    "drive_read_file",
    "Read the content of a file from Google Drive. Automatically exports Google Workspace files (Docs to Markdown, Sheets to CSV, Slides to plain text). For regular files, returns the text content directly.",
    inputSchema,
    async (args) => {
      try {
        const metadata = await getFileMetadata(drive, args.fileId);
        const header = `File: ${metadata.name}\nMIME: ${metadata.mimeType}\nID: ${metadata.id}\n`;

        if (isWorkspaceFile(metadata.mimeType)) {
          const exportMime = resolveExportMimeType(metadata.mimeType, args.exportFormat);
          const formats = getAvailableFormats(metadata.mimeType);
          const content = await exportWorkspaceFile(drive, args.fileId, exportMime);
          return {
            content: [{
              type: "text" as const,
              text: `${header}Export format: ${args.exportFormat ?? "default"} (${exportMime})\nAvailable formats: ${formats.join(", ")}\n---\n${content}`,
            }],
          };
        }

        const content = await readFileContent(drive, args.fileId);
        return {
          content: [{ type: "text" as const, text: `${header}---\n${content}` }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error reading file: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
}
