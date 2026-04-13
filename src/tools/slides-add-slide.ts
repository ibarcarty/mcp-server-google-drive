import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SlidesClient } from "../types.js";
import { addSlide } from "../drive/slides.js";

const inputSchema = {
  presentationId: z.string().describe("The ID of the Google Slides presentation."),
  insertionIndex: z.number().optional().describe("Position to insert the slide (0 = first). Omit to add at the end."),
};

export function registerSlidesAddSlideTool(server: McpServer, slides: SlidesClient): void {
  server.tool(
    "slides_add_slide",
    "Add a new blank slide to a Google Slides presentation. Returns the ID of the new slide.",
    inputSchema,
    async (args) => {
      try {
        const slideId = await addSlide(slides, args.presentationId, args.insertionIndex);
        return {
          content: [{ type: "text" as const, text: `Slide created successfully.\nSlide ID: ${slideId}` }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error adding slide: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
}
