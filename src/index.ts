#!/usr/bin/env node

import { loadConfig } from "./config.js";
import { runAuthFlow } from "./auth/oauth.js";
import { createAuthenticatedClient } from "./auth/credentials.js";
import { createDriveClient, createDocsClient, createSheetsClient } from "./drive/client.js";
import { createServer } from "./server.js";
import { startStdio } from "./transport/stdio.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const command = process.argv[2];

  // Auth subcommand
  if (command === "auth") {
    await runAuthFlow(config);
    process.exit(0);
  }

  // Start MCP server
  const authClient = createAuthenticatedClient(config);
  const clients = {
    drive: createDriveClient(authClient),
    docs: createDocsClient(authClient),
    sheets: createSheetsClient(authClient),
  };

  if (config.transport === "http") {
    // HTTP: stateless mode — server created per request inside startHttp
    const { startHttp } = await import("./transport/http.js");
    await startHttp(clients, config);
  } else {
    // Stdio: single server instance for the session
    const server = createServer(clients);
    await startStdio(server);
  }

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.error("\nShutting down MCP server...");
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.error("\nShutting down MCP server...");
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Fatal error:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
