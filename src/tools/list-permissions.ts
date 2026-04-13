import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DriveClient } from "../types.js";
import { listPermissions } from "../drive/permissions.js";

const inputSchema = {
  fileId: z.string().describe("The ID of the file or folder to list permissions for."),
};

export function registerListPermissionsTool(server: McpServer, drive: DriveClient): void {
  server.tool(
    "drive_list_permissions",
    "List all permissions (who has access) for a file or folder in Google Drive.",
    inputSchema,
    async (args) => {
      try {
        const result = await listPermissions(drive, args.fileId);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error listing permissions: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
}
