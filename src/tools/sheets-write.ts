import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SheetsClient } from "../types.js";
import { writeRange } from "../drive/sheets.js";

const inputSchema = {
  spreadsheetId: z.string().describe("The ID of the Google Sheet."),
  range: z.string().describe("The A1 notation range to write to, e.g. 'Sheet1!A1:D3'."),
  values: z.array(z.array(z.string())).describe("2D array of values. Each inner array is a row. e.g. [['Name','Age'],['Alice','30'],['Bob','25']]"),
};

export function registerSheetsWriteTool(server: McpServer, sheets: SheetsClient): void {
  server.tool(
    "sheets_write_range",
    "Write values to a range of cells in a Google Sheet. Values are parsed as if typed by a user (formulas are evaluated, dates formatted).",
    inputSchema,
    async (args) => {
      try {
        const result = await writeRange(sheets, args.spreadsheetId, args.range, args.values);
        return {
          content: [{ type: "text" as const, text: `Written successfully.\nRange: ${result.updatedRange}\nRows: ${result.updatedRows}\nColumns: ${result.updatedColumns}` }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error writing range: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
}
