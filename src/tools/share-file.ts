import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DriveClient } from "../types.js";
import { shareFile } from "../drive/permissions.js";

const inputSchema = {
  fileId: z.string().describe("The ID of the file or folder to share."),
  email: z.string().email().describe("Email address of the person to share with."),
  role: z.enum(["reader", "writer", "commenter"]).describe("Permission level: 'reader', 'writer', or 'commenter'."),
  sendNotification: z.boolean().default(false).optional().describe("Send an email notification to the recipient (default false)."),
};

export function registerShareFileTool(server: McpServer, drive: DriveClient): void {
  server.tool(
    "drive_share",
    "Share a file or folder with a specific user by email. Grants reader, writer, or commenter access.",
    inputSchema,
    async (args) => {
      try {
        const result = await shareFile(drive, args);
        return {
          content: [{ type: "text" as const, text: `File shared successfully.\n${JSON.stringify(result, null, 2)}` }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error sharing file: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
}
