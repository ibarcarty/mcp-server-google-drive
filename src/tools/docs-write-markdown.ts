import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DocsClient } from "../types.js";
import { writeMarkdown } from "../drive/markdown-to-docs.js";

const inputSchema = {
  documentId: z.string().describe("The ID of the Google Doc."),
  markdown: z.string().describe("Markdown content to write. Supports GitHub Flavored Markdown: headings (# ## ###), bold (**text**), italic (*text*), strikethrough (~~text~~), inline code (`code`), links, lists (ordered/unordered), code blocks (```lang```), tables, and blockquotes."),
  mode: z.enum(["append", "replace_all"]).default("append").describe("append: add markdown at the end of the document. replace_all: clear the document and write the markdown fresh. Default: append."),
};

export function registerDocsWriteMarkdownTool(server: McpServer, docs: DocsClient): void {
  server.tool(
    "docs_write_markdown",
    "Write GitHub Flavored Markdown to a Google Doc with native rich formatting (headings, bold, italic, strikethrough, inline code, code blocks, links, lists, tables, blockquotes). Unlike docs_append_text which writes raw text, this tool converts markdown to native Google Docs formatting (updateTextStyle, updateParagraphStyle, insertTable, createParagraphBullets).",
    inputSchema,
    async (args) => {
      try {
        const result = await writeMarkdown(docs, args.documentId, args.markdown, { mode: args.mode });
        return {
          content: [{
            type: "text" as const,
            text: `Markdown written successfully to document ${args.documentId} (mode: ${args.mode}). Inserted ${result.insertedChars} characters. Styled ${result.paragraphsStyled} paragraphs, ${result.textRangesStyled} text ranges, created ${result.bulletsCreated} bullet lists, inserted ${result.tablesInserted} tables.`,
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: "text" as const,
            text: `Error writing markdown: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    },
  );
}
