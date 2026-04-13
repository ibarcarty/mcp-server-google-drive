import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DriveClient } from "../types.js";
import { createFolder } from "../drive/files.js";

const inputSchema = {
  name: z.string().describe("Folder name."),
  parentFolderId: z.string().optional().describe("ID of the parent folder. Omit to create in root."),
};

export function registerCreateFolderTool(server: McpServer, drive: DriveClient): void {
  server.tool(
    "drive_create_folder",
    "Create a new folder in Google Drive.",
    inputSchema,
    async (args) => {
      try {
        const result = await createFolder(drive, args);
        return {
          content: [{ type: "text" as const, text: `Folder created successfully.\n${JSON.stringify(result, null, 2)}` }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error creating folder: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
}
