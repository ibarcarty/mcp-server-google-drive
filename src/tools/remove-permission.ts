import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DriveClient } from "../types.js";
import { removePermission } from "../drive/permissions.js";

const inputSchema = {
  fileId: z.string().describe("The ID of the file or folder."),
  permissionId: z.string().describe("The ID of the permission to remove. Get this from drive_list_permissions."),
};

export function registerRemovePermissionTool(server: McpServer, drive: DriveClient): void {
  server.tool(
    "drive_remove_permission",
    "Remove a specific permission (revoke access) from a file or folder. Use drive_list_permissions first to get the permission ID.",
    inputSchema,
    async (args) => {
      try {
        await removePermission(drive, args);
        return {
          content: [{ type: "text" as const, text: `Permission ${args.permissionId} removed successfully from file ${args.fileId}.` }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error removing permission: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
}
