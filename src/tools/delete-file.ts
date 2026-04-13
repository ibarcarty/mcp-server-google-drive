import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DriveClient } from "../types.js";
import { deleteFile, getFileMetadata } from "../drive/files.js";

const inputSchema = {
  fileId: z.string().describe("The ID of the file or folder to delete."),
};

export function registerDeleteFileTool(server: McpServer, drive: DriveClient): void {
  server.tool(
    "drive_delete_file",
    "Permanently delete a file or folder from Google Drive. This action cannot be undone. Use with caution.",
    inputSchema,
    async (args) => {
      try {
        const metadata = await getFileMetadata(drive, args.fileId);
        await deleteFile(drive, args.fileId);
        return {
          content: [{ type: "text" as const, text: `File deleted successfully: "${metadata.name}" (${metadata.id})` }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error deleting file: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
}
