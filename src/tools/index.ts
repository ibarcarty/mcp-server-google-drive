import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DriveClient } from "../types.js";
import { registerListFilesTool } from "./list-files.js";
import { registerSearchTool } from "./search-files.js";
import { registerReadFileTool } from "./read-file.js";
import { registerCreateFileTool } from "./create-file.js";
import { registerCreateFolderTool } from "./create-folder.js";
import { registerUpdateFileTool } from "./update-file.js";
import { registerDeleteFileTool } from "./delete-file.js";
import { registerMoveFileTool } from "./move-file.js";
import { registerCopyFileTool } from "./copy-file.js";
import { registerShareFileTool } from "./share-file.js";
import { registerListPermissionsTool } from "./list-permissions.js";
import { registerRemovePermissionTool } from "./remove-permission.js";

export function registerAllTools(server: McpServer, drive: DriveClient): void {
  // Read operations
  registerListFilesTool(server, drive);
  registerSearchTool(server, drive);
  registerReadFileTool(server, drive);

  // Write operations
  registerCreateFileTool(server, drive);
  registerCreateFolderTool(server, drive);
  registerUpdateFileTool(server, drive);
  registerDeleteFileTool(server, drive);
  registerMoveFileTool(server, drive);
  registerCopyFileTool(server, drive);

  // Permissions
  registerShareFileTool(server, drive);
  registerListPermissionsTool(server, drive);
  registerRemovePermissionTool(server, drive);
}
