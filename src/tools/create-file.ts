import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DriveClient } from "../types.js";
import { createFile } from "../drive/files.js";

const inputSchema = {
  name: z.string().describe("File name including extension (e.g. 'report.md', 'data.csv')."),
  content: z.string().optional().describe("Text content for the file. Omit for empty files or Google Workspace files."),
  mimeType: z.string().optional().describe("MIME type. Use 'application/vnd.google-apps.document' for Google Docs, 'application/vnd.google-apps.spreadsheet' for Sheets."),
  parentFolderId: z.string().optional().describe("ID of the parent folder. Omit to create in root."),
};

export function registerCreateFileTool(server: McpServer, drive: DriveClient): void {
  server.tool(
    "drive_create_file",
    "Create a new file in Google Drive. Supports uploading text content directly. For creating Google Docs/Sheets, set the appropriate MIME type.",
    inputSchema,
    async (args) => {
      try {
        const result = await createFile(drive, args);
        return {
          content: [{ type: "text" as const, text: `File created successfully.\n${JSON.stringify(result, null, 2)}` }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error creating file: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
}
