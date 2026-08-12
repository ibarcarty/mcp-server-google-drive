import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DriveClient } from "../types.js";
import { deleteFile, trashFile, getFileForDelete, isNotFoundError } from "../drive/files.js";

const inputSchema = {
  fileId: z.string().describe("The ID of the file or folder to delete."),
};

export function registerDeleteFileTool(server: McpServer, drive: DriveClient): void {
  server.tool(
    "drive_delete_file",
    "Delete a file or folder from Google Drive. Deletes permanently when allowed; when permanent deletion is not permitted (e.g. shared drives where you are not an organizer), moves the item to the trash instead and says so.",
    inputSchema,
    async (args) => {
      try {
        const metadata = await getFileForDelete(drive, args.fileId);
        const label = `"${metadata.name}" (${metadata.id})`;
        const caps = metadata.capabilities;

        if (caps && caps.canDelete === false) {
          if (caps.canTrash) {
            await trashFile(drive, args.fileId);
            return {
              content: [{
                type: "text" as const,
                text:
                  `Moved to trash: ${label}. Permanent deletion is not permitted for you here — ` +
                  `in shared drives it requires the organizer role (the Drive API would answer an ambiguous 404 otherwise). ` +
                  `The item can be restored from the trash; shared-drive trash is auto-purged after 30 days.`,
              }],
            };
          }
          return {
            content: [{
              type: "text" as const,
              text: `Cannot delete ${label}: you have permission to neither delete nor trash this item (capabilities: canDelete=false, canTrash=false).`,
            }],
            isError: true,
          };
        }

        try {
          await deleteFile(drive, args.fileId);
        } catch (err) {
          if (isNotFoundError(err)) {
            return {
              content: [{
                type: "text" as const,
                text:
                  `Drive answered 404 (not found) for ${label}. This means either the file no longer exists, ` +
                  `or you lack the required permission — the Drive API returns the same 404 when a non-organizer ` +
                  `attempts a permanent delete in a shared drive.`,
              }],
              isError: true,
            };
          }
          throw err;
        }
        return {
          content: [{ type: "text" as const, text: `File permanently deleted: ${label}` }],
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
