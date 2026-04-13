import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DriveClient } from "../types.js";
import { updateFile } from "../drive/files.js";

const inputSchema = {
  fileId: z.string().describe("The ID of the file to update."),
  name: z.string().optional().describe("New file name (rename)."),
  content: z.string().optional().describe("New text content to replace the file's content."),
  mimeType: z.string().optional().describe("MIME type for the new content."),
};

export function registerUpdateFileTool(server: McpServer, drive: DriveClient): void {
  server.tool(
    "drive_update_file",
    "Update a file's content or metadata (rename). Can replace content for plain text, JSON, CSV, and binary files. Note: cannot edit Google Docs/Sheets content directly — only metadata.",
    inputSchema,
    async (args) => {
      try {
        const result = await updateFile(drive, args);
        return {
          content: [{ type: "text" as const, text: `File updated successfully.\n${JSON.stringify(result, null, 2)}` }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error updating file: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
}
