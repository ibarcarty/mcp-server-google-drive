# OAuth Setup Guide

This guide walks you through creating OAuth credentials in Google Cloud Console.

## Prerequisites

- A Google account (personal or Google Workspace)
- Access to [Google Cloud Console](https://console.cloud.google.com/)

## Steps

### 1. Create or select a GCP project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click the project dropdown at the top
3. Click **New Project** (or select an existing one)
4. Give it a name (e.g., "MCP Google Drive")

### 2. Enable the required APIs

Go to **APIs & Services** > **Library** and enable **all three** APIs:

1. Search for **"Google Drive API"** → Click **Enable**
2. Search for **"Google Docs API"** → Click **Enable**
3. Search for **"Google Sheets API"** → Click **Enable**

All three are free and required for the full functionality of this MCP server.

### 3. Configure the OAuth Consent Screen

1. Go to **APIs & Services** > **OAuth consent screen**
2. Select **External** (or **Internal** if using Google Workspace and you only need access within your organization)
3. Fill in:
   - **App name**: "MCP Google Drive" (or any name you prefer)
   - **User support email**: your email
   - **Developer contact**: your email
4. Click **Save and Continue**
5. On the **Scopes** page, click **Add or Remove Scopes**
   - Add: `https://www.googleapis.com/auth/drive`
   - (This single scope covers Drive, Docs, and Sheets access)
6. Click **Save and Continue**
7. On the **Test users** page, add your Google account email
8. Click **Save and Continue**

### 4. Create OAuth Client ID

1. Go to **APIs & Services** > **Credentials**
2. Click **Create Credentials** > **OAuth client ID**
3. Select **Desktop app** as the application type
4. Give it a name (e.g., "MCP Google Drive Desktop")
5. Click **Create**
6. Click **Download JSON**

### 5. Place the credentials file

Move the downloaded JSON file to the default config location:

**macOS/Linux:**
```bash
mkdir -p ~/.config/mcp-server-google-drive
mv ~/Downloads/client_secret_*.json ~/.config/mcp-server-google-drive/oauth-credentials.json
```

**Windows (PowerShell):**
```powershell
New-Item -ItemType Directory -Force -Path "$env:APPDATA\mcp-server-google-drive"
Move-Item "$HOME\Downloads\client_secret_*.json" "$env:APPDATA\mcp-server-google-drive\oauth-credentials.json"
```

Or set the path via environment variable:
```bash
export GDRIVE_MCP_OAUTH_PATH=/your/custom/path/oauth-credentials.json
```

### 6. Authenticate

If the package is published on npm:
```bash
npx @ibarcarty/mcp-server-google-drive auth
```

If you installed from source:
```bash
node dist/index.js auth
```

This will:
1. Open your browser to Google's consent page
2. Ask you to authorize the app
3. Save tokens to `~/.config/mcp-server-google-drive/tokens.json` (or `%APPDATA%\mcp-server-google-drive\tokens.json` on Windows)

You only need to do this once. Tokens refresh automatically.

## Testing Mode vs Production

- **Testing mode** (default): Limited to 100 test users. Tokens expire after 7 days. No Google verification needed.
- **Production mode**: Unlimited users. Requires Google verification for the `drive` scope.

For personal use, testing mode is sufficient. Just re-run `auth` if tokens expire.

## Troubleshooting

### "This app hasn't been verified"

This is normal in testing mode. Click **Advanced** > **Go to [app name] (unsafe)** to proceed.

### "Access blocked: Authorization Error"

Make sure your email is added as a test user in the OAuth consent screen settings.

### "Google Docs API has not been used in project... before or it is disabled"

You need to enable the Google Docs API (and/or Google Sheets API) in your GCP project. Go to **APIs & Services** > **Library**, search for the API, and click **Enable**. See Step 2 above.

### Token expired

Re-run the auth command:
```bash
npx @ibarcarty/mcp-server-google-drive auth
```
