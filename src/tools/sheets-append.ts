import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SheetsClient } from "../types.js";
import { appendRows } from "../drive/sheets.js";

const inputSchema = {
  spreadsheetId: z.string().describe("The ID of the Google Sheet."),
  range: z.string().describe("The A1 notation range that defines the table, e.g. 'Sheet1!A:D'. Data is appended after the last row with data."),
  values: z.array(z.array(z.string())).describe("2D array of rows to append. e.g. [['Alice','30'],['Bob','25']]"),
};

export function registerSheetsAppendTool(server: McpServer, sheets: SheetsClient): void {
  server.tool(
    "sheets_append_rows",
    "Append rows after the last row with data in a Google Sheet. Useful for adding entries to a table without knowing the exact row number.",
    inputSchema,
    async (args) => {
      try {
        const result = await appendRows(sheets, args.spreadsheetId, args.range, args.values);
        return {
          content: [{ type: "text" as const, text: `Rows appended successfully.\nRange: ${result.updatedRange}\nRows added: ${result.updatedRows}` }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error appending rows: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
}
