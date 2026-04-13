import path from "node:path";
import os from "node:os";
import type { Config } from "./types.js";

function getDefaultConfigDir(): string {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "mcp-server-google-drive");
  }
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "mcp-server-google-drive");
}

function parseCliArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--")) {
      const [key, value] = arg.slice(2).split("=", 2);
      if (key && value !== undefined) {
        args[key] = value;
      }
    }
  }
  return args;
}

export function loadConfig(): Config {
  const configDir = getDefaultConfigDir();
  const cliArgs = parseCliArgs(process.argv);

  const oauthCredentialsPath =
    cliArgs["oauth-path"] ??
    process.env.GDRIVE_MCP_OAUTH_PATH ??
    path.join(configDir, "oauth-credentials.json");

  const tokenPath =
    cliArgs["token-path"] ??
    process.env.GDRIVE_MCP_TOKEN_PATH ??
    path.join(configDir, "tokens.json");

  const scopeStr =
    cliArgs["scopes"] ??
    process.env.GDRIVE_MCP_SCOPES ??
    "https://www.googleapis.com/auth/drive";

  const scopes = scopeStr.includes(",") ? scopeStr.split(",").map(s => s.trim()) : [scopeStr];

  const transport = (
    cliArgs["transport"] ??
    process.env.GDRIVE_MCP_TRANSPORT ??
    "stdio"
  ) as "stdio" | "http";

  const httpPort = parseInt(
    cliArgs["port"] ??
    process.env.GDRIVE_MCP_PORT ??
    "8080",
    10
  );

  const httpHost =
    cliArgs["host"] ??
    process.env.GDRIVE_MCP_HOST ??
    "0.0.0.0";

  return {
    oauthCredentialsPath,
    tokenPath,
    scopes,
    transport,
    httpPort,
    httpHost,
  };
}
