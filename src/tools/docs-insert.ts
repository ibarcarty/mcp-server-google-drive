import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DocsClient } from "../types.js";
import { insertText } from "../drive/docs.js";

const inputSchema = {
  documentId: z.string().describe("The ID of the Google Doc."),
  text: z.string().describe("Text to insert."),
  index: z.number().min(1).describe("The character index where text will be inserted. Use docs_read to see available indexes. Index 1 = beginning of document."),
};

export function registerDocsInsertTool(server: McpServer, docs: DocsClient): void {
  server.tool(
    "docs_insert_text",
    "Insert text at a specific position in a Google Doc. Use docs_read first to see the document structure and available indexes.",
    inputSchema,
    async (args) => {
      try {
        await insertText(docs, args.documentId, args.text, args.index);
        return {
          content: [{ type: "text" as const, text: `Text inserted at index ${args.index} in document ${args.documentId}.` }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error inserting text: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
}
