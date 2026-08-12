import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DriveClient } from "../types.js";
import { getFileInfo } from "../drive/files.js";

const inputSchema = {
  fileId: z.string().describe("The ID of the file or folder to inspect."),
};

export function registerGetFileInfoTool(server: McpServer, drive: DriveClient): void {
  server.tool(
    "drive_get_file_info",
    "Get metadata for a file or folder by ID: name, type, size, timestamps, parent folder (resolved to its name), shared drive, owners, capabilities and links. Use this to identify an item from its ID without listing or reading its content.",
    inputSchema,
    async (args) => {
      try {
        const info = await getFileInfo(drive, args.fileId);
        const f = info.file;
        const lines: string[] = [
          `File: ${f.name}`,
          `ID: ${f.id}`,
          `Type: ${f.mimeType}`,
        ];
        if (f.size !== undefined) lines.push(`Size: ${f.size} bytes`);
        if (f.createdTime) lines.push(`Created: ${f.createdTime}`);
        if (f.modifiedTime) lines.push(`Modified: ${f.modifiedTime}`);
        for (const parent of info.parents) {
          lines.push(`Parent: ${parent.name} (${parent.id})`);
        }
        if (info.sharedDrive) {
          lines.push(`Shared drive: ${info.sharedDrive.name} (${info.sharedDrive.id})`);
        }
        if (f.owners?.length) {
          lines.push(`Owner(s): ${f.owners.map((o) => [o.displayName, o.emailAddress && `<${o.emailAddress}>`].filter(Boolean).join(" ")).join(", ")}`);
        }
        if (f.lastModifyingUser?.displayName) {
          lines.push(`Last modified by: ${f.lastModifyingUser.displayName}`);
        }
        if (f.capabilities) {
          const caps = Object.entries(f.capabilities)
            .map(([k, v]) => `${k}=${v}`)
            .join(", ");
          lines.push(`Capabilities: ${caps}`);
        }
        if (f.trashed) lines.push("Trashed: yes");
        if (f.shortcutDetails?.targetId) {
          lines.push(`Shortcut target: ${f.shortcutDetails.targetId} (${f.shortcutDetails.targetMimeType ?? "unknown type"})`);
        }
        if (f.webViewLink) lines.push(`Link: ${f.webViewLink}`);
        if (f.md5Checksum) lines.push(`MD5: ${f.md5Checksum}`);

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error getting file info: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
}
