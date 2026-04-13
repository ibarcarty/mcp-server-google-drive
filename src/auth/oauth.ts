import http from "node:http";
import { URL } from "node:url";
import { OAuth2Client } from "google-auth-library";
import type { Config } from "../types.js";
import { loadOAuthClientCredentials, saveTokens } from "./credentials.js";

const CALLBACK_PORT = 3456;
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/callback`;

export async function runAuthFlow(config: Config): Promise<void> {
  const creds = loadOAuthClientCredentials(config);

  const client = new OAuth2Client({
    clientId: creds.installed.client_id,
    clientSecret: creds.installed.client_secret,
    redirectUri: REDIRECT_URI,
  });

  const authUrl = client.generateAuthUrl({
    access_type: "offline",
    scope: config.scopes,
    prompt: "consent",
  });

  // Start local callback server
  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url?.startsWith("/callback")) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const url = new URL(req.url, `http://localhost:${CALLBACK_PORT}`);
      const authCode = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<html><body><h1>Authentication failed</h1><p>${error}</p><p>You can close this window.</p></body></html>`);
        server.close();
        reject(new Error(`Authentication failed: ${error}`));
        return;
      }

      if (!authCode) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(`<html><body><h1>Missing authorization code</h1><p>You can close this window.</p></body></html>`);
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<html><body><h1>Authentication successful!</h1><p>You can close this window and return to the terminal.</p></body></html>`);
      server.close();
      resolve(authCode);
    });

    server.listen(CALLBACK_PORT, () => {
      console.error(`\nOpening browser for authentication...`);
      console.error(`If the browser doesn't open, visit:\n${authUrl}\n`);

      // Dynamic import for ESM-only 'open' package
      import("open").then((mod) => mod.default(authUrl)).catch(() => {
        console.error("Could not open browser automatically. Please open the URL above manually.");
      });
    });

    server.on("error", (err) => {
      reject(new Error(`Failed to start callback server on port ${CALLBACK_PORT}: ${err.message}`));
    });
  });

  // Exchange code for tokens
  console.error("Exchanging authorization code for tokens...");
  const { tokens } = await client.getToken(code);

  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error("Failed to obtain tokens. Try again and make sure to grant all permissions.");
  }

  saveTokens(config, {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date ?? 0,
    token_type: tokens.token_type ?? "Bearer",
    scope: tokens.scope ?? config.scopes.join(" "),
  });

  console.error(`\nAuthentication successful! Tokens saved to ${config.tokenPath}`);
  console.error("You can now use the MCP server.");
}
