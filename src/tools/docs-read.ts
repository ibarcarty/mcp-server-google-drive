import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DocsClient } from "../types.js";
import { getDocument } from "../drive/docs.js";

const inputSchema = {
  documentId: z.string().describe("The ID of the Google Doc to read. Get this from drive_search or drive_list_files."),
};

export function registerDocsReadTool(server: McpServer, docs: DocsClient): void {
  server.tool(
    "docs_read",
    "Read the full content of a Google Doc as structured text. Returns text with heading markers (# ## ###) and paragraph indexes that can be used with docs_insert_text.",
    inputSchema,
    async (args) => {
      try {
        const result = await getDocument(docs, args.documentId);
        return {
          content: [{
            type: "text" as const,
            text: `Document: ${result.title}\nEnd index: ${result.endIndex}\n---\n${result.body}`,
          }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error reading document: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
}
