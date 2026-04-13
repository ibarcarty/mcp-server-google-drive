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

### 2. Enable the Google Drive API

1. Go to **APIs & Services** > **Library**
2. Search for "Google Drive API"
3. Click **Enable**

### 3. Configure the OAuth Consent Screen

1. Go to **APIs & Services** > **OAuth consent screen**
2. Select **External** (or Internal if using Google Workspace)
3. Fill in:
   - **App name**: "MCP Google Drive" (or any name)
   - **User support email**: your email
   - **Developer contact**: your email
4. Click **Save and Continue**
5. On the **Scopes** page, click **Add or Remove Scopes**
   - Add: `https://www.googleapis.com/auth/drive`
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

**Windows:**
```powershell
mkdir "$env:APPDATA\mcp-server-google-drive" -Force
mv "$HOME\Downloads\client_secret_*.json" "$env:APPDATA\mcp-server-google-drive\oauth-credentials.json"
```

Or set the path via environment variable:
```bash
export GDRIVE_MCP_OAUTH_PATH=/your/custom/path/oauth-credentials.json
```

### 6. Authenticate

```bash
npx @ibarcarty/mcp-server-google-drive auth
```

This will:
1. Open your browser to Google's consent page
2. Ask you to authorize the app
3. Save tokens to `~/.config/mcp-server-google-drive/tokens.json`

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

### Token expired

Re-run the auth command:
```bash
npx @ibarcarty/mcp-server-google-drive auth
```
