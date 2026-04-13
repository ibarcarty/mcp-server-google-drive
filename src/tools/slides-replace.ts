import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SlidesClient } from "../types.js";
import { replaceAllText } from "../drive/slides.js";

const inputSchema = {
  presentationId: z.string().describe("The ID of the Google Slides presentation."),
  findText: z.string().describe("The text to search for across all slides."),
  replaceText: z.string().describe("The text to replace all occurrences with."),
  matchCase: z.boolean().default(true).optional().describe("Whether the search is case-sensitive (default true)."),
};

export function registerSlidesReplaceTool(server: McpServer, slides: SlidesClient): void {
  server.tool(
    "slides_replace_text",
    "Find and replace all occurrences of text across all slides in a Google Slides presentation.",
    inputSchema,
    async (args) => {
      try {
        const count = await replaceAllText(slides, args.presentationId, args.findText, args.replaceText, args.matchCase);
        return {
          content: [{ type: "text" as const, text: `Replaced ${count} occurrence(s) of "${args.findText}" with "${args.replaceText}".` }],
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
