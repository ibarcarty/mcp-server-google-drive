# Local Setup Guide

Run the MCP server locally using stdio transport. This is the recommended setup for personal use.

## Prerequisites

- Node.js >= 20
- OAuth credentials set up ([OAuth Setup Guide](oauth-setup.md))
- Authentication completed (`npx @ibarcarty/mcp-server-google-drive auth`)

## Configuration

### Claude Code (VS Code Extension)

Run in your terminal:
```bash
claude mcp add google-drive npx -- -y @ibarcarty/mcp-server-google-drive
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

After configuring, restart Claude Code/Desktop and try:

- "List my Drive files" → should use `drive_list_files`
- "Search for documents about [topic]" → should use `drive_search`
- "Read the file with ID [fileId]" → should use `drive_read_file`

## Troubleshooting

### "No saved tokens found"

Run authentication first:
```bash
npx @ibarcarty/mcp-server-google-drive auth
```

### "OAuth credentials not found"

Make sure your `GDRIVE_MCP_OAUTH_PATH` points to the correct file, or place it in the default location.

### Server shows as "Connected" but tools fail

Restart Claude Code/Desktop. The MCP server starts when the session begins — if credentials were added after startup, a restart is needed.
