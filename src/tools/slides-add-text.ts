import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SlidesClient } from "../types.js";
import { addTextToSlide } from "../drive/slides.js";

const inputSchema = {
  presentationId: z.string().describe("The ID of the Google Slides presentation."),
  elementId: z.string().describe("The ID of the shape/placeholder to insert text into. Use slides_read to find element IDs."),
  text: z.string().describe("Text to insert."),
  insertionIndex: z.number().optional().describe("Character index within the element to insert at. 0 = beginning. Omit to insert at the start."),
};

export function registerSlidesAddTextTool(server: McpServer, slides: SlidesClient): void {
  server.tool(
    "slides_add_text",
    "Insert text into a specific shape or placeholder on a Google Slide. Use slides_read first to find the element ID.",
    inputSchema,
    async (args) => {
      try {
        await addTextToSlide(slides, args.presentationId, args.elementId, args.text, args.insertionIndex);
        return {
          content: [{ type: "text" as const, text: `Text inserted into element ${args.elementId}.` }],
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
