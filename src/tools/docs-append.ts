import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DocsClient } from "../types.js";
import { appendText } from "../drive/docs.js";

const inputSchema = {
  documentId: z.string().describe("The ID of the Google Doc."),
  text: z.string().describe("Text to append at the end of the document."),
};

export function registerDocsAppendTool(server: McpServer, docs: DocsClient): void {
  server.tool(
    "docs_append_text",
    "Append text at the end of a Google Doc. The text is added after all existing content.",
    inputSchema,
    async (args) => {
      try {
        await appendText(docs, args.documentId, args.text);
        return {
          content: [{ type: "text" as const, text: `Text appended successfully to document ${args.documentId}.` }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error appending text: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
}
