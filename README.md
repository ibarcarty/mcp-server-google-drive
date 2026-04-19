# @ibarcarty/mcp-server-google-drive

A Model Context Protocol (MCP) server for Google Drive, Google Docs, Google Sheets, and Google Slides with **full read/write operations** and **rich markdown formatting**. Search, read, create, edit, delete, move, copy files, edit documents with native formatting, manage spreadsheets, modify presentations, and control permissions — including shared drives.

Built with official Google APIs (`googleapis`) and the official MCP SDK (`@modelcontextprotocol/sdk`).

## Features

- **27 tools** for complete Google Drive, Docs, Sheets, and Slides management
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
| `drive_read_file` | Read file content. Auto-exports Workspace files |
| `drive_create_file` | Create a new file with optional content |
| `drive_create_folder` | Create a new folder |
| `drive_update_file` | Update file content or rename |
| `drive_delete_file` | Permanently delete a file or folder |
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

## Configuration

All configuration is via environment variables. All are optional with sensible defaults.

| Variable | Default | Description |
|----------|---------|-------------|
| `GDRIVE_MCP_OAUTH_PATH` | `~/.config/mcp-server-google-drive/oauth-credentials.json` | OAuth client credentials file |
| `GDRIVE_MCP_TOKEN_PATH` | `~/.config/mcp-server-google-drive/tokens.json` | Saved tokens file |
| `GDRIVE_MCP_SCOPES` | `https://www.googleapis.com/auth/drive` | OAuth scopes |
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
```

## OAuth Scopes

This server uses `https://www.googleapis.com/auth/drive` (full Drive access) by default. This scope also covers Google Docs, Google Sheets, and Google Slides APIs.

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

## Changelog

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
