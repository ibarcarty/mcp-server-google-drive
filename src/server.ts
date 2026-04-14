import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DriveClient, DocsClient, SheetsClient, SlidesClient } from "./types.js";
import { registerAllTools } from "./tools/index.js";

export interface Clients {
  drive: DriveClient;
  docs: DocsClient;
  sheets: SheetsClient;
  slides: SlidesClient;
}

export function createServer(clients: Clients): McpServer {
  const server = new McpServer(
    {
      name: "mcp-server-google-drive",
      version: "1.0.1",
    },
    {
      capabilities: {
        tools: {},
      },
      instructions:
        "Google Drive MCP server with full CRUD, Google Docs editing, Google Sheets editing, and Google Slides editing. " +
        "Use drive_search or drive_list_files to find files — file IDs are required for most operations. " +
        "For Google Docs: use docs_read to read content, docs_append_text/docs_insert_text to write, docs_replace_text to find & replace. " +
        "For Google Sheets: use sheets_read_range to read cells, sheets_write_range to write, sheets_append_rows to add rows. " +
        "For Google Slides: use slides_read to read content, slides_add_slide to add slides, slides_add_text to write text, slides_replace_text to find & replace. " +
        "For file management: create, update, delete, move, copy files and manage permissions. " +
        "Shared drives are included by default in all operations.",
    },
  );

  registerAllTools(server, clients.drive, clients.docs, clients.sheets, clients.slides);
  return server;
}
