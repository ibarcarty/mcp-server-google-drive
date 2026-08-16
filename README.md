# @ibarcarty/mcp-server-google-drive

A Model Context Protocol (MCP) server for Google Drive, Google Docs, Google Sheets, Google Slides, and Google Calendar with **full read/write operations** and **rich markdown formatting**. Search, read, create, edit, delete, move, copy files, edit documents with native formatting, manage spreadsheets, modify presentations, manage calendar events, and control permissions — including shared drives.

Built with official Google APIs (`googleapis`) and the official MCP SDK (`@modelcontextprotocol/sdk`).

## Features

- **32 tools** for complete Google Drive, Docs, Sheets, Slides, and Calendar management
- **Google Calendar**: list events (recurring events expanded), create timed or all-day events with recurrence (RRULE) and reminders, update, and delete. All-day end dates are inclusive (the server handles the API's exclusive convention)
- **Safe reads for any size**: regular files are read by byte ranges (`offset`/`maxBytes`) — a 90MB file no longer kills the transport, you page through it
- **Office files readable**: `.docx`/`.xlsx`/`.pptx` (and legacy/OpenDocument variants) are converted to text on read via a temporary Google Workspace copy — no more lossy binary dumps
- **Shared-drive-aware deletes**: when permanent deletion is not permitted (non-organizer in a shared drive), the file is moved to trash with a clear explanation instead of a misleading `File not found`
- **File metadata by ID** (`drive_get_file_info`): name, type, size, timestamps, parent folder resolved to its name, shared drive, owners, capabilities
- **Rich markdown → Google Docs** (`docs_write_markdown`): headings, bold, italic, strikethrough, inline code, code blocks, tables, lists, links, blockquotes — all as native Google Docs formatting
- **Document theming** (`docs_apply_theme`): apply a consistent visual theme (typography, colors, spacing, margins) to an entire document. Built-in `corporate` and `minimal` themes. Custom themes loadable from a JSON file via env var
- **Corporate document templates** (`docs_apply_corporate_template`): initialize a document with title, metadata, change log, classification badge, and footer — useful for standard corporate deliverables
- **Google Docs editing**: read, append, insert, find & replace, and write formatted markdown
- **Google Sheets editing**: read, write, append rows, and clear cell ranges
- **Google Slides editing**: read presentations, add slides, insert text, and find & replace
- **File management**: create, read, update, delete, move, copy files and folders
- **Permissions**: share files, list access, revoke permissions
- **Shared drives** supported by default in all operations
- **Google Workspace export**: Docs → Markdown, Sheets → CSV, Slides → text
- **Two transport modes**: local (stdio) and remote (Streamable HTTP for Cloud Run)
- **OAuth2** with automatic token refresh
- **TypeScript** — fully typed, strict mode

## Quick Start

### 1. Set up OAuth credentials

Follow the [OAuth Setup Guide](docs/oauth-setup.md) to create credentials in Google Cloud Console.

**Important:** You must enable these APIs in your GCP project:
- Google Drive API
- Google Docs API
- Google Sheets API
- Google Slides API
- Google Calendar API (for the `calendar_*` tools)

### 2. Install

**From npm:**
```bash
npx @ibarcarty/mcp-server-google-drive auth
```

**From source:**
```bash
git clone https://github.com/ibarcarty/mcp-server-google-drive.git
cd mcp-server-google-drive
npm install --ignore-scripts
npm run build
node dist/index.js auth
```

This opens your browser to authorize with your Google account. Tokens are saved locally.

### 3. Configure Claude Code / Claude Desktop

**From npm:**
```json
{
  "mcpServers": {
    "google-drive": {
      "command": "npx",
      "args": ["-y", "@ibarcarty/mcp-server-google-drive"],
      "env": {
        "GDRIVE_MCP_OAUTH_PATH": "/path/to/your/oauth-credentials.json"
      }
    }
  }
}
```

**From source:**
```json
{
  "mcpServers": {
    "google-drive": {
      "command": "node",
      "args": ["/path/to/mcp-server-google-drive/dist/index.js"],
      "env": {
        "GDRIVE_MCP_OAUTH_PATH": "/path/to/your/oauth-credentials.json"
      }
    }
  }
}
```

See [Local Setup Guide](docs/setup-local.md) for detailed instructions.

## Tools

### Drive — File Operations

| Tool | Description |
|------|-------------|
| `drive_list_files` | List files/folders with filtering, pagination, and sorting |
| `drive_search` | Search by name or content (full-text search) |
| `drive_read_file` | Read file content by byte ranges. Auto-exports Workspace files, converts Office files to text |
| `drive_get_file_info` | Metadata for an ID: name, size, parent folder (resolved to its name), shared drive, capabilities |
| `drive_create_file` | Create a new file with optional content |
| `drive_create_folder` | Create a new folder |
| `drive_update_file` | Update file content or rename |
| `drive_delete_file` | Delete a file or folder (falls back to trash in shared drives when permanent delete is not permitted) |
| `drive_move_file` | Move to a different folder |
| `drive_copy_file` | Copy a file, optionally to a different folder |

### Drive — Permissions

| Tool | Description |
|------|-------------|
| `drive_share` | Share a file with a user (reader/writer/commenter) |
| `drive_list_permissions` | List who has access to a file |
| `drive_remove_permission` | Revoke access from a user |

### Google Docs — Document Editing

| Tool | Description |
|------|-------------|
| `docs_read` | Read document content with structure (headings, indexes) |
| `docs_append_text` | Append plain text at the end of a document |
| `docs_insert_text` | Insert plain text at a specific position (by index) |
| `docs_replace_text` | Find and replace text throughout a document |
| `docs_write_markdown` | Write GitHub Flavored Markdown with native rich formatting (headings, bold, italic, strikethrough, inline code, code blocks, tables, lists, links, blockquotes) |
| `docs_apply_theme` | Apply a predefined visual theme (typography, colors, spacing, margins) to an entire document. Built-in: `corporate`, `minimal`. Custom themes loadable from JSON |
| `docs_apply_corporate_template` | Initialize a document with title, metadata, change log, classification badge, and footer |

#### Markdown-to-Docs example

```javascript
// Write rich markdown to an existing Google Doc
await mcp.callTool("docs_write_markdown", {
  documentId: "1abc...xyz",
  markdown: `
# Project Report

## Summary
This project delivers **three key features**:

- Feature A with *italic emphasis*
- Feature B using \`inline code\`
- Feature C — [see docs](https://example.com)

## Timeline

| Phase | Start | End |
|-------|-------|-----|
| Design | Jan | Feb |
| Build | Mar | May |
`,
  mode: "append",  // or "replace_all"
});

// Apply the built-in corporate theme
await mcp.callTool("docs_apply_theme", {
  documentId: "1abc...xyz",
  theme: "corporate",
});
```

#### Custom themes

Built-in themes (`corporate`, `minimal`) cover most cases. For custom branding, point `GDRIVE_MCP_CUSTOM_THEMES_PATH` to a JSON file:

```json
{
  "my-brand": {
    "name": "my-brand",
    "fontFamily": "Arial",
    "lineSpacing": 115,
    "margins": { "top": 71, "bottom": 71, "left": 71, "right": 71 },
    "styles": {
      "TITLE":       { "fontSize": 26, "bold": true, "color": { "red": 0.0,  "green": 0.32, "blue": 0.53 }, "spaceAbove": 0,  "spaceBelow": 12 },
      "SUBTITLE":    { "fontSize": 16,                "color": { "red": 0.18, "green": 0.18, "blue": 0.18 }, "spaceAbove": 0,  "spaceBelow": 12 },
      "HEADING_1":   { "fontSize": 20, "bold": true, "color": { "red": 0.0,  "green": 0.32, "blue": 0.53 }, "spaceAbove": 16, "spaceBelow": 6 },
      "HEADING_2":   { "fontSize": 16, "bold": true, "color": { "red": 0.30, "green": 0.51, "blue": 0.74 }, "spaceAbove": 12, "spaceBelow": 4 },
      "HEADING_3":   { "fontSize": 13, "bold": true, "color": { "red": 0.30, "green": 0.51, "blue": 0.74 }, "spaceAbove": 10, "spaceBelow": 4 },
      "HEADING_4":   { "fontSize": 12, "bold": true, "color": { "red": 0.18, "green": 0.18, "blue": 0.18 }, "spaceAbove": 8,  "spaceBelow": 2 },
      "HEADING_5":   { "fontSize": 11, "bold": true, "color": { "red": 0.18, "green": 0.18, "blue": 0.18 }, "spaceAbove": 6,  "spaceBelow": 2 },
      "HEADING_6":   { "fontSize": 10, "bold": true, "color": { "red": 0.18, "green": 0.18, "blue": 0.18 }, "spaceAbove": 6,  "spaceBelow": 2 },
      "NORMAL_TEXT": { "fontSize": 11,                "color": { "red": 0.18, "green": 0.18, "blue": 0.18 }, "spaceAbove": 0,  "spaceBelow": 4 }
    }
  }
}
```

Then apply it by name: `{ theme: "my-brand" }`.

The markdown is parsed with `remark` + `remark-gfm` (CommonMark + GFM extensions) and converted to native Google Docs `batchUpdate` requests (`insertText`, `updateTextStyle`, `updateParagraphStyle`, `insertTable`, `createParagraphBullets`, `updateTableCellStyle`). No markdown characters remain in the document — it becomes native Google Docs formatting.

### Google Sheets — Spreadsheet Editing

| Tool | Description |
|------|-------------|
| `sheets_read_range` | Read cell values from a range (A1 notation) |
| `sheets_write_range` | Write values to a range of cells |
| `sheets_append_rows` | Append rows after the last row with data |
| `sheets_clear_range` | Clear values in a range (formatting preserved) |

### Google Slides — Presentation Editing

| Tool | Description |
|------|-------------|
| `slides_read` | Read all slides with text content and element IDs |
| `slides_add_slide` | Add a new slide to the presentation |
| `slides_add_text` | Insert text into a specific shape/placeholder |
| `slides_replace_text` | Find and replace text across all slides |

### Google Calendar — Event Management

| Tool | Description |
|------|-------------|
| `calendar_list_events` | List events in a time window (recurring events expanded into instances, ordered by start time). Returns the event IDs used by update/delete |
| `calendar_create_event` | Create a timed or all-day event, with optional recurrence (RRULE), reminders (popup/email), location and description. Timed events default to Europe/Madrid and 1h duration; all-day end dates are inclusive |
| `calendar_update_event` | Patch fields of an existing event (only the provided fields change) |
| `calendar_delete_event` | Delete an event by ID (a recurring event's parent removes all instances) |

## Configuration

All configuration is via environment variables. All are optional with sensible defaults.

| Variable | Default | Description |
|----------|---------|-------------|
| `GDRIVE_MCP_OAUTH_PATH` | `~/.config/mcp-server-google-drive/oauth-credentials.json` | OAuth client credentials file |
| `GDRIVE_MCP_TOKEN_PATH` | `~/.config/mcp-server-google-drive/tokens.json` | Saved tokens file |
| `GDRIVE_MCP_SCOPES` | `https://www.googleapis.com/auth/drive,https://www.googleapis.com/auth/calendar` | OAuth scopes (comma-separated) |
| `GDRIVE_MCP_TRANSPORT` | `stdio` | Transport: `stdio` or `http` |
| `GDRIVE_MCP_PORT` | `8080` | HTTP port (for `http` transport) |
| `GDRIVE_MCP_HOST` | `0.0.0.0` | HTTP bind address |
| `GDRIVE_MCP_CUSTOM_THEMES_PATH` | *(unset)* | Optional path to a JSON file with custom theme specifications |

On Windows, the default config directory is `%APPDATA%/mcp-server-google-drive/`.

## Deployment

### Local (recommended for personal use)

Uses stdio transport. See [Local Setup Guide](docs/setup-local.md).

### Google Cloud Run (for teams)

Uses Streamable HTTP transport. See [Cloud Run Deployment Guide](docs/setup-cloudrun.md).

## Development

```bash
git clone https://github.com/ibarcarty/mcp-server-google-drive.git
cd mcp-server-google-drive
npm install --ignore-scripts
npm run build
npm test          # unit tests (node:test via tsx, API fully mocked)
npm run smoke     # live smoke test against the real Drive API (requires credentials; creates and removes its own fixtures)
```

## OAuth Scopes

This server uses `https://www.googleapis.com/auth/drive` (full Drive access — also covers Google Docs, Google Sheets, and Google Slides) plus `https://www.googleapis.com/auth/calendar` (Google Calendar) by default.

**Upgrading from ≤1.2.x:** tokens saved before v1.3.0 lack the calendar scope. Re-run the auth flow once (`node dist/index.js auth` or `npx @ibarcarty/mcp-server-google-drive auth`) to grant it; the `calendar_*` tools return an actionable error until then.

If you only need access to files created by this app, you can use the more restrictive `drive.file` scope:

```bash
GDRIVE_MCP_SCOPES=https://www.googleapis.com/auth/drive.file npx @ibarcarty/mcp-server-google-drive auth
```

**Note:** The `drive` scope requires Google verification for apps with 100+ users. For personal use or small teams (< 100 users), testing mode works without verification.

## Limitations

- `docs_write_markdown` covers CommonMark + GFM (headings, emphasis, lists, links, code blocks, blockquotes, tables, strikethrough). Images, footnotes, and task lists with interactive checkboxes are rendered as plain text or placeholders.
- Google Slides editing supports text operations and adding slides. Complex layout operations (positioning shapes, animations) require using the raw Slides API.
- Export of Workspace files has a 10MB limit (Google API limitation).
- Binary file uploads are limited to text content passed as strings. For large binary files, use Google Drive directly.
- Binary files (PDF, images, archives…) are reported with their metadata but not returned inline — decoding them as text would be lossy. Office files are the exception: they are converted to text on read.
- `drive_read_file` returns at most 2MB per call (default window 200KB). Page through larger files with `offset`.
- Reading a byte range of a UTF-8 text file may split a multibyte character at the window boundaries.

## Changelog

### v1.3.0

- **NEW** Google Calendar support (4 tools, test-first with 13 contract tests): `calendar_list_events` (recurring events expanded via `singleEvents`, ordered by start time), `calendar_create_event` (timed or all-day; RRULE recurrence; popup/email reminders; Europe/Madrid default timezone; 1h default duration; inclusive all-day end dates converted to the API's exclusive convention), `calendar_update_event` (patch semantics), `calendar_delete_event`.
- Default OAuth scopes now include `https://www.googleapis.com/auth/calendar`. Existing tokens keep working for Drive/Docs/Sheets/Slides; re-run the auth flow once to enable the calendar tools. A 403 for a missing scope returns an actionable message instead of a raw API error.
- Requires the Google Calendar API to be enabled in the GCP project.

### v1.2.0

Four defects found using the server against a large real-world Drive, all fixed test-first (17 unit tests + an 11-case live smoke suite, `test/`):

- **FIX** `drive_read_file` no longer downloads files whole: reads go through byte ranges (`Range` header) with a 200KB default window and new `offset`/`maxBytes` parameters. Previously a 90MB file crashed the stdio transport (`Connection closed`). Truncated responses say exactly how to continue.
- **FIX** `drive_read_file` converts Office files (`.docx`, `.xlsx`, `.pptx`, legacy and OpenDocument variants) to text via a temporary Google Workspace copy (always cleaned up, even on failure). Previously the raw bytes were decoded as UTF-8, producing irreversible `U+FFFD` mojibake. Binary files (PDF, images, archives) are now reported instead of dumped; binary *export formats* of Workspace files get a clear message pointing to the text formats.
- **FIX** `drive_delete_file` handles shared drives correctly: the Drive API answers an ambiguous **404 "File not found"** (not 403) when a non-organizer attempts a permanent delete in a shared drive — verified live, with and without `supportsAllDrives`. The tool now checks `capabilities` first and falls back to moving the item to the trash with a transparent message; a genuine 404 explains both possible causes.
- **NEW** `drive_get_file_info`: metadata for a file/folder ID — name, type, size, timestamps, parent folder resolved to its name, shared drive name, owners, capabilities, links. Previously there was no way to identify an item from its ID without listing its contents.
- **FIX** The MCP server now announces its real version (was hardcoded to an older one).

### v1.1.1

- **Maintenance**: harden `build` script to clean `dist/` before compiling (prevents stale artifacts from previous compilations being published). Users should upgrade from v1.1.0 to this version.
- No functional changes vs v1.1.0.

### v1.1.0

- **NEW** `docs_write_markdown`: convert GitHub Flavored Markdown to native Google Docs formatting (headings, bold, italic, strikethrough, inline code, code blocks, tables, lists, links, blockquotes).
- **NEW** `docs_apply_theme`: apply a consistent visual theme across a document. Built-in themes: `corporate` (Arial, corporate blue), `minimal` (Inter, neutral). Custom themes can be loaded from a JSON file via `GDRIVE_MCP_CUSTOM_THEMES_PATH`.
- **NEW** `docs_apply_corporate_template`: initialize a document with a standard corporate structure (title, metadata, change log, classification badge, footer).
- Parser powered by `unified` + `remark-parse` + `remark-gfm` (industry standard).
- Zero extra token cost vs raw text — model sends markdown, server handles the conversion.

### v1.0.1

- Initial public release with 24 tools across Drive, Docs, Sheets, Slides.

## License

MIT
