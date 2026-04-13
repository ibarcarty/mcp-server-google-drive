import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DriveClient } from "../types.js";
import { listFiles } from "../drive/files.js";

const inputSchema = {
  folderId: z.string().optional().describe("Parent folder ID to list contents of. Omit for root."),
  pageSize: z.number().min(1).max(100).default(20).optional().describe("Number of results per page (1-100, default 20)."),
  pageToken: z.string().optional().describe("Token for fetching the next page of results."),
  mimeType: z.string().optional().describe("Filter by MIME type, e.g. 'application/vnd.google-apps.folder' for folders only."),
  orderBy: z.string().optional().describe("Sort order, e.g. 'modifiedTime desc', 'name'. Default: 'modifiedTime desc'."),
  includeSharedDrives: z.boolean().default(true).optional().describe("Include files from shared drives (default true)."),
};

export function registerListFilesTool(server: McpServer, drive: DriveClient): void {
  server.tool(
    "drive_list_files",
    "List files and folders in Google Drive. Supports filtering by folder, MIME type, pagination, and shared drives.",
    inputSchema,
    async (args) => {
      try {
        const result = await listFiles(drive, args);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error listing files: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
}
