import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SlidesClient } from "../types.js";
import { getPresentation } from "../drive/slides.js";

const inputSchema = {
  presentationId: z.string().describe("The ID of the Google Slides presentation. Get this from drive_search or drive_list_files."),
};

export function registerSlidesReadTool(server: McpServer, slides: SlidesClient): void {
  server.tool(
    "slides_read",
    "Read the full content of a Google Slides presentation. Returns all slides with their text content and element IDs (needed for slides_add_text).",
    inputSchema,
    async (args) => {
      try {
        const result = await getPresentation(slides, args.presentationId);

        let output = `Presentation: ${result.title}\nSlides: ${result.slidesCount}\n---\n`;
        for (const slide of result.slides) {
          output += `\n## Slide ${slide.index + 1} (id: ${slide.slideId})\n`;
          for (const el of slide.elements) {
            if (el.text.trim()) {
              output += `  [${el.type} id:${el.elementId}] ${el.text.trim()}\n`;
            }
          }
        }

        return {
          content: [{ type: "text" as const, text: output }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error reading presentation: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
}
