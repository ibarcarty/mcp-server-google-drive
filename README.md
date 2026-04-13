# @ibarcarty/mcp-server-google-drive

A Model Context Protocol (MCP) server for Google Drive, Google Docs, and Google Sheets with **full read/write operations**. Search, read, create, edit, delete, move, copy files, edit document content, manage spreadsheet data, and control permissions — including shared drives.

Built with official Google APIs (`googleapis`) and the official MCP SDK (`@modelcontextprotocol/sdk`). No third-party dependencies.

## Features

- **20 tools** for complete Google Drive, Docs, and Sheets management
- **Google Docs editing**: read, append, insert, and find & replace text directly in documents
- **Google Sheets editing**: read, write, append rows, and clear cell ranges
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

### 2. Install

**From npm** (when published):
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
| `docs_append_text` | Append text at the end of a document |
| `docs_insert_text` | Insert text at a specific position (by index) |
| `docs_replace_text` | Find and replace text throughout a document |

### Google Sheets — Spreadsheet Editing

| Tool | Description |
|------|-------------|
| `sheets_read_range` | Read cell values from a range (A1 notation) |
| `sheets_write_range` | Write values to a range of cells |
| `sheets_append_rows` | Append rows after the last row with data |
| `sheets_clear_range` | Clear values in a range (formatting preserved) |

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

This server uses `https://www.googleapis.com/auth/drive` (full Drive access) by default. This scope also covers Google Docs and Google Sheets APIs.

If you only need access to files created by this app, you can use the more restrictive `drive.file` scope:

```bash
GDRIVE_MCP_SCOPES=https://www.googleapis.com/auth/drive.file npx @ibarcarty/mcp-server-google-drive auth
```

**Note:** The `drive` scope requires Google verification for apps with 100+ users. For personal use or small teams (< 100 users), testing mode works without verification.

## Limitations

- Google Docs editing supports text operations (insert, append, replace). Complex formatting (tables, images, styles) requires using the raw Docs API.
- Export of Workspace files has a 10MB limit (Google API limitation).
- Binary file uploads are limited to text content passed as strings. For large binary files, use Google Drive directly.

## License

MIT
