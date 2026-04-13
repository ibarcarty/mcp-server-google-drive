import fs from "node:fs";
import path from "node:path";
import { OAuth2Client } from "google-auth-library";
import type { Config, OAuthClientCredentials, SavedTokens } from "../types.js";

export function loadOAuthClientCredentials(config: Config): OAuthClientCredentials {
  // Try JSON env var first (for Cloud Run)
  const jsonEnv = process.env.GDRIVE_MCP_OAUTH_CREDENTIALS_JSON;
  if (jsonEnv) {
    return JSON.parse(jsonEnv) as OAuthClientCredentials;
  }

  if (!fs.existsSync(config.oauthCredentialsPath)) {
    throw new Error(
      `OAuth credentials not found at ${config.oauthCredentialsPath}\n` +
      `Download your OAuth client ID JSON from Google Cloud Console and place it there.\n` +
      `See: https://github.com/ibarcarty/mcp-server-google-drive/blob/main/docs/oauth-setup.md`
    );
  }

  const raw = fs.readFileSync(config.oauthCredentialsPath, "utf-8");
  return JSON.parse(raw) as OAuthClientCredentials;
}

export function loadSavedTokens(config: Config): SavedTokens {
  // Try JSON env var first (for Cloud Run)
  const jsonEnv = process.env.GDRIVE_MCP_TOKENS_JSON;
  if (jsonEnv) {
    return JSON.parse(jsonEnv) as SavedTokens;
  }

  if (!fs.existsSync(config.tokenPath)) {
    throw new Error(
      `No saved tokens found at ${config.tokenPath}\n` +
      `Run 'npx @ibarcarty/mcp-server-google-drive auth' to authenticate first.`
    );
  }

  const raw = fs.readFileSync(config.tokenPath, "utf-8");
  return JSON.parse(raw) as SavedTokens;
}

export function saveTokens(config: Config, tokens: SavedTokens): void {
  const dir = path.dirname(config.tokenPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(config.tokenPath, JSON.stringify(tokens, null, 2), "utf-8");
}

export function createAuthenticatedClient(config: Config): OAuth2Client {
  const creds = loadOAuthClientCredentials(config);
  const tokens = loadSavedTokens(config);

  const client = new OAuth2Client({
    clientId: creds.installed.client_id,
    clientSecret: creds.installed.client_secret,
  });

  client.setCredentials(tokens);

  // Auto-save refreshed tokens
  client.on("tokens", (newTokens) => {
    const merged: SavedTokens = {
      access_token: newTokens.access_token ?? tokens.access_token,
      refresh_token: newTokens.refresh_token ?? tokens.refresh_token,
      expiry_date: newTokens.expiry_date ?? tokens.expiry_date,
      token_type: newTokens.token_type ?? tokens.token_type ?? "Bearer",
      scope: tokens.scope,
    };
    saveTokens(config, merged);
  });

  return client;
}
