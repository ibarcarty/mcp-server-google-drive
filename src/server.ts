import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DriveClient } from "./types.js";
import { registerAllTools } from "./tools/index.js";

export function createServer(driveClient: DriveClient): McpServer {
  const server = new McpServer(
    {
      name: "mcp-server-google-drive",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
      instructions:
        "Google Drive MCP server with full CRUD operations. " +
        "Use drive_search or drive_list_files to find files before reading or modifying them. " +
        "File IDs are required for most operations — get them from search/list results. " +
        "Google Docs/Sheets/Slides are automatically exported to readable formats (Markdown, CSV, plain text). " +
        "Cannot edit Google Docs/Sheets content directly — only metadata and plain text/binary files. " +
        "Shared drives are included by default in all operations.",
    },
  );

  registerAllTools(server, driveClient);
  return server;
}
