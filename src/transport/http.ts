import http from "node:http";
import type { Config, DriveClient } from "../types.js";
import { createServer } from "../server.js";

export async function startHttp(driveClient: DriveClient, config: Config): Promise<void> {
  const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");

  const httpServer = http.createServer(async (req, res) => {
    // Health check
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    // MCP endpoint — stateless: new server + transport per request
    if (req.url === "/mcp" && req.method === "POST") {
      const server = createServer(driveClient);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // Stateless mode for Cloud Run
      });

      res.on("close", () => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
      });

      try {
        await server.connect(transport);
        await transport.handleRequest(req, res);
      } catch (error) {
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          }));
        }
      }
      return;
    }

    // GET and DELETE on /mcp not supported in stateless mode
    if (req.url === "/mcp") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed. Use POST." },
        id: null,
      }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found. Use POST /mcp for MCP or GET /health for health check." }));
  });

  httpServer.listen(config.httpPort, config.httpHost, () => {
    console.error(`MCP Google Drive server running on http://${config.httpHost}:${config.httpPort}/mcp`);
    console.error(`Health check: http://${config.httpHost}:${config.httpPort}/health`);
  });

  const shutdown = () => {
    console.error("\nShutting down HTTP server...");
    httpServer.close(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
