import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DocsClient } from "../types.js";
import { applyTheme, listThemes } from "../drive/themes/corporate.js";

const inputSchema = {
  documentId: z.string().describe("The ID of the Google Doc to apply the theme to."),
  theme: z.string().describe("Theme name. Built-in themes: 'corporate' (Arial, corporate blue palette, 1.15 line-height, 1in margins), 'minimal' (Inter, neutral colors, clean spacing). Additional custom themes can be loaded from a JSON file via the GDRIVE_MCP_CUSTOM_THEMES_PATH environment variable."),
};

export function registerDocsApplyThemeTool(server: McpServer, docs: DocsClient): void {
  server.tool(
    "docs_apply_theme",
    "Apply a predefined visual theme to an entire Google Doc. A theme sets typography (font family, sizes), colors, paragraph spacing, line height, and page margins consistently across the document. Built-in themes: 'corporate' and 'minimal'. Custom themes can be registered by pointing the GDRIVE_MCP_CUSTOM_THEMES_PATH env var to a JSON file with theme specifications.",
    inputSchema,
    async (args) => {
      try {
        const result = await applyTheme(docs, args.documentId, args.theme);
        return {
          content: [{
            type: "text" as const,
            text: `Theme "${result.theme}" applied successfully to document ${args.documentId}. Styled ${result.paragraphsStyled} paragraphs. Available themes: ${listThemes().join(", ")}.`,
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: "text" as const,
            text: `Error applying theme: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    },
  );
}
