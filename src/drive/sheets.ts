import type { SheetsClient } from "../types.js";

export interface SheetRange {
  range: string;
  values: string[][];
}

/**
 * Read values from a range of cells in a Google Sheet.
 */
export async function readRange(
  sheets: SheetsClient,
  spreadsheetId: string,
  range: string,
): Promise<SheetRange> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  return {
    range: res.data.range ?? range,
    values: (res.data.values ?? []) as string[][],
  };
}

/**
 * Write values to a range of cells in a Google Sheet.
 * Values are parsed as if typed by a user (formulas evaluated, dates formatted).
 */
export async function writeRange(
  sheets: SheetsClient,
  spreadsheetId: string,
  range: string,
  values: string[][],
): Promise<{ updatedRange: string; updatedRows: number; updatedColumns: number }> {
  const res = await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });

  return {
    updatedRange: res.data.updatedRange ?? range,
    updatedRows: res.data.updatedRows ?? 0,
    updatedColumns: res.data.updatedColumns ?? 0,
  };
}

/**
 * Append rows after the last row with data in a Google Sheet.
 */
export async function appendRows(
  sheets: SheetsClient,
  spreadsheetId: string,
  range: string,
  values: string[][],
): Promise<{ updatedRange: string; updatedRows: number }> {
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });

  return {
    updatedRange: res.data.updates?.updatedRange ?? range,
    updatedRows: res.data.updates?.updatedRows ?? 0,
  };
}

/**
 * Clear all values in a range of cells (structure and formatting preserved).
 */
export async function clearRange(
  sheets: SheetsClient,
  spreadsheetId: string,
  range: string,
): Promise<string> {
  const res = await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range,
  });

  return res.data.clearedRange ?? range;
}
