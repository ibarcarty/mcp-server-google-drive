import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DocsClient } from "../types.js";
import { replaceAllText } from "../drive/docs.js";

const inputSchema = {
  documentId: z.string().describe("The ID of the Google Doc."),
  findText: z.string().describe("The text to search for in the document."),
  replaceText: z.string().describe("The text to replace all occurrences with."),
  matchCase: z.boolean().default(true).optional().describe("Whether the search is case-sensitive (default true)."),
};

export function registerDocsReplaceTool(server: McpServer, docs: DocsClient): void {
  server.tool(
    "docs_replace_text",
    "Find and replace all occurrences of text in a Google Doc. Returns the number of replacements made.",
    inputSchema,
    async (args) => {
      try {
        const count = await replaceAllText(docs, args.documentId, args.findText, args.replaceText, args.matchCase);
        return {
          content: [{ type: "text" as const, text: `Replaced ${count} occurrence(s) of "${args.findText}" with "${args.replaceText}" in document ${args.documentId}.` }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error replacing text: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
}
