# Local Setup Guide

Run the MCP server locally using stdio transport. This is the recommended setup for personal use.

## Prerequisites

- Node.js >= 20
- OAuth credentials set up ([OAuth Setup Guide](oauth-setup.md))
- Authentication completed (see below)

## Install and Authenticate

### Option A: From npm (when published)

```bash
npx @ibarcarty/mcp-server-google-drive auth
```

### Option B: From source

```bash
git clone https://github.com/ibarcarty/mcp-server-google-drive.git
cd mcp-server-google-drive
npm install --ignore-scripts
npm run build
node dist/index.js auth
```

## Configuration

### Claude Code (VS Code Extension)

**From npm:**
```bash
claude mcp add google-drive -- npx -y @ibarcarty/mcp-server-google-drive
```

**From source (using local build):**
```bash
claude mcp add google-drive -e GDRIVE_MCP_OAUTH_PATH=/path/to/oauth-credentials.json -- node /path/to/mcp-server-google-drive/dist/index.js
```

Or add manually to your MCP configuration:

```json
{
  "mcpServers": {
    "google-drive": {
      "command": "npx",
      "args": ["-y", "@ibarcarty/mcp-server-google-drive"],
      "env": {
        "GDRIVE_MCP_OAUTH_PATH": "/path/to/oauth-credentials.json"
      }
    }
  }
}
```

### Claude Desktop

Add to `claude_desktop_config.json`:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "google-drive": {
      "command": "npx",
      "args": ["-y", "@ibarcarty/mcp-server-google-drive"],
      "env": {
        "GDRIVE_MCP_OAUTH_PATH": "/path/to/oauth-credentials.json"
      }
    }
  }
}
```

### Custom paths

If your credentials are in a non-default location, set both paths:

```json
{
  "env": {
    "GDRIVE_MCP_OAUTH_PATH": "/custom/path/oauth-credentials.json",
    "GDRIVE_MCP_TOKEN_PATH": "/custom/path/tokens.json"
  }
}
```

## Verify it works

After configuring, **restart Claude Code/Desktop** and try these prompts:

**Drive operations:**
- "List my Drive files" → uses `drive_list_files`
- "Search for documents about quarterly report" → uses `drive_search`

**Google Docs editing:**
- "Read the Google Doc with ID [docId]" → uses `docs_read`
- "Append a summary to the document" → uses `docs_append_text`

**Google Sheets editing:**
- "Read cells A1:D10 from spreadsheet [sheetId]" → uses `sheets_read_range`
- "Write these values to the spreadsheet" → uses `sheets_write_range`

## Troubleshooting

### "No saved tokens found"

Run authentication first:
```bash
npx @ibarcarty/mcp-server-google-drive auth
# or from source: node dist/index.js auth
```

### "OAuth credentials not found"

Make sure your `GDRIVE_MCP_OAUTH_PATH` points to the correct file, or place it in the default location (`~/.config/mcp-server-google-drive/oauth-credentials.json` on macOS/Linux, `%APPDATA%\mcp-server-google-drive\oauth-credentials.json` on Windows).

### "Google Docs API has not been used in project..."

Enable the Google Docs API and Google Sheets API in your GCP project. See [OAuth Setup Guide, Step 2](oauth-setup.md).

### Server shows as "Connected" but tools fail

Restart Claude Code/Desktop. The MCP server starts when the session begins — if credentials were added after startup, a restart is needed.
