import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DriveClient } from "../types.js";
import { copyFile } from "../drive/files.js";

const inputSchema = {
  fileId: z.string().describe("The ID of the file to copy."),
  name: z.string().optional().describe("Name for the copy. Defaults to 'Copy of [original name]'."),
  destinationFolderId: z.string().optional().describe("Folder to place the copy in. Defaults to same folder as original."),
};

export function registerCopyFileTool(server: McpServer, drive: DriveClient): void {
  server.tool(
    "drive_copy_file",
    "Create a copy of a file in Google Drive. Optionally rename the copy and/or place it in a different folder.",
    inputSchema,
    async (args) => {
      try {
        const result = await copyFile(drive, args);
        return {
          content: [{ type: "text" as const, text: `File copied successfully.\n${JSON.stringify(result, null, 2)}` }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error copying file: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
}
