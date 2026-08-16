import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DriveClient, DocsClient, SheetsClient, SlidesClient, CalendarClient } from "./types.js";
import { registerAllTools } from "./tools/index.js";

// Single source of truth for the announced version (was hardcoded and stale).
const pkg = createRequire(import.meta.url)("../package.json") as { version: string };

export interface Clients {
  drive: DriveClient;
  docs: DocsClient;
  sheets: SheetsClient;
  slides: SlidesClient;
  calendar: CalendarClient;
}

export function createServer(clients: Clients): McpServer {
  const server = new McpServer(
    {
      name: "mcp-server-google-drive",
      version: pkg.version,
    },
    {
      capabilities: {
        tools: {},
      },
      instructions:
        "Google Drive MCP server with full CRUD, Google Docs editing, Google Sheets editing, and Google Slides editing. " +
        "Use drive_search or drive_list_files to find files — file IDs are required for most operations. " +
        "Use drive_get_file_info to identify an item from its ID (name, parent folder, size, shared drive). " +
        "Large regular files are read by byte ranges (offset/maxBytes); Office files (.docx/.xlsx/.pptx) are converted to text on read. " +
        "For Google Docs: use docs_read to read content, docs_append_text/docs_insert_text to write, docs_replace_text to find & replace. " +
        "For Google Sheets: use sheets_read_range to read cells, sheets_write_range to write, sheets_append_rows to add rows. " +
        "For Google Slides: use slides_read to read content, slides_add_slide to add slides, slides_add_text to write text, slides_replace_text to find & replace. " +
        "For file management: create, update, delete, move, copy files and manage permissions. " +
        "For Google Calendar: use calendar_list_events to read events (returns event IDs), calendar_create_event to create timed or all-day events with optional recurrence and reminders, calendar_update_event to patch fields, calendar_delete_event to remove events. " +
        "Shared drives are included by default in all operations.",
    },
  );

  registerAllTools(server, clients.drive, clients.docs, clients.sheets, clients.slides, clients.calendar);
  return server;
}
