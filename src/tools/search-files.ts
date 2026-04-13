import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DriveClient } from "../types.js";
import { searchFiles } from "../drive/files.js";

const inputSchema = {
  query: z.string().describe("Search text. Matches file names and/or content."),
  searchIn: z.enum(["fullText", "name"]).default("fullText").optional().describe("Where to search: 'fullText' (name + content) or 'name' only. Default: 'fullText'."),
  mimeType: z.string().optional().describe("Filter results to a specific MIME type."),
  pageSize: z.number().min(1).max(100).default(20).optional().describe("Number of results per page (1-100, default 20)."),
  pageToken: z.string().optional().describe("Token for fetching the next page of results."),
  includeSharedDrives: z.boolean().default(true).optional().describe("Include files from shared drives (default true)."),
};

export function registerSearchTool(server: McpServer, drive: DriveClient): void {
  server.tool(
    "drive_search",
    "Search for files in Google Drive by name or content. Supports full-text search, name matching, and MIME type filtering.",
    inputSchema,
    async (args) => {
      try {
        const result = await searchFiles(drive, args);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error searching files: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
}
