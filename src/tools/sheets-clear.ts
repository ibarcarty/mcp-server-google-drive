import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SheetsClient } from "../types.js";
import { clearRange } from "../drive/sheets.js";

const inputSchema = {
  spreadsheetId: z.string().describe("The ID of the Google Sheet."),
  range: z.string().describe("The A1 notation range to clear, e.g. 'Sheet1!A1:D10'. Clears values only — formatting is preserved."),
};

export function registerSheetsClearTool(server: McpServer, sheets: SheetsClient): void {
  server.tool(
    "sheets_clear_range",
    "Clear all values in a range of cells in a Google Sheet. Formatting and structure are preserved, only values are removed.",
    inputSchema,
    async (args) => {
      try {
        const clearedRange = await clearRange(sheets, args.spreadsheetId, args.range);
        return {
          content: [{ type: "text" as const, text: `Range cleared successfully: ${clearedRange}` }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error clearing range: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
}
