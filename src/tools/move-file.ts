import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DriveClient } from "../types.js";
import { moveFile } from "../drive/files.js";

const inputSchema = {
  fileId: z.string().describe("The ID of the file or folder to move."),
  destinationFolderId: z.string().describe("The ID of the destination folder."),
};

export function registerMoveFileTool(server: McpServer, drive: DriveClient): void {
  server.tool(
    "drive_move_file",
    "Move a file or folder to a different parent folder in Google Drive.",
    inputSchema,
    async (args) => {
      try {
        const result = await moveFile(drive, args);
        return {
          content: [{ type: "text" as const, text: `File moved successfully.\n${JSON.stringify(result, null, 2)}` }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error moving file: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
}
