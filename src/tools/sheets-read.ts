import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SheetsClient } from "../types.js";
import { readRange } from "../drive/sheets.js";

const inputSchema = {
  spreadsheetId: z.string().describe("The ID of the Google Sheet. Get this from drive_search or drive_list_files."),
  range: z.string().describe("The A1 notation range to read, e.g. 'Sheet1!A1:D10', 'A1:Z', 'Sheet1'. Use sheet name + range for specific sheets."),
};

export function registerSheetsReadTool(server: McpServer, sheets: SheetsClient): void {
  server.tool(
    "sheets_read_range",
    "Read values from a range of cells in a Google Sheet. Returns a 2D array of cell values using A1 notation.",
    inputSchema,
    async (args) => {
      try {
        const result = await readRange(sheets, args.spreadsheetId, args.range);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error reading range: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
}
