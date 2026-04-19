import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root, RootContent, PhrasingContent, Heading, Paragraph, List, ListItem, Code, Table, Blockquote, ThematicBreak } from "mdast";
import type { docs_v1 } from "googleapis";
import type { DocsClient } from "../types.js";

type DocsRequest = docs_v1.Schema$Request;

interface TextRange {
  start: number;
  end: number;
}

interface ParagraphStyleRange extends TextRange {
  namedStyleType: "HEADING_1" | "HEADING_2" | "HEADING_3" | "HEADING_4" | "HEADING_5" | "HEADING_6" | "NORMAL_TEXT" | "TITLE" | "SUBTITLE";
}

interface TextStyleRange extends TextRange {
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  code?: boolean;
  link?: string;
}

interface BulletRange extends TextRange {
  preset: "BULLET_DISC_CIRCLE_SQUARE" | "NUMBERED_DECIMAL_ALPHA_ROMAN";
}

interface CodeBlockRange extends TextRange {
  language?: string;
}

interface TableSpec {
  placeholderIndex: number;
  rows: number;
  cols: number;
  cells: string[][];
  cellStyles: TextStyleRange[][][];
}

interface Buffer {
  text: string;
  paragraphStyles: ParagraphStyleRange[];
  textStyles: TextStyleRange[];
  bullets: BulletRange[];
  codeBlocks: CodeBlockRange[];
  tables: TableSpec[];
}

function newBuffer(): Buffer {
  return { text: "", paragraphStyles: [], textStyles: [], bullets: [], codeBlocks: [], tables: [] };
}

function renderInline(nodes: PhrasingContent[], buf: Buffer, ctx: { bold?: boolean; italic?: boolean; strikethrough?: boolean; link?: string }): void {
  for (const node of nodes) {
    if (node.type === "text") {
      const start = buf.text.length;
      buf.text += node.value;
      const end = buf.text.length;
      if (ctx.bold || ctx.italic || ctx.strikethrough || ctx.link) {
        buf.textStyles.push({ start, end, bold: ctx.bold, italic: ctx.italic, strikethrough: ctx.strikethrough, link: ctx.link });
      }
    } else if (node.type === "strong") {
      renderInline(node.children, buf, { ...ctx, bold: true });
    } else if (node.type === "emphasis") {
      renderInline(node.children, buf, { ...ctx, italic: true });
    } else if (node.type === "delete") {
      renderInline(node.children, buf, { ...ctx, strikethrough: true });
    } else if (node.type === "inlineCode") {
      const start = buf.text.length;
      buf.text += node.value;
      const end = buf.text.length;
      buf.textStyles.push({ start, end, code: true });
    } else if (node.type === "link") {
      renderInline(node.children, buf, { ...ctx, link: node.url });
    } else if (node.type === "break") {
      buf.text += "\u000B";
    } else if (node.type === "image") {
      buf.text += `[Image: ${node.alt ?? node.url}]`;
    } else if ("children" in node && Array.isArray(node.children)) {
      renderInline(node.children as PhrasingContent[], buf, ctx);
    }
  }
}

function extractPlainText(nodes: PhrasingContent[]): string {
  let out = "";
  for (const node of nodes) {
    if (node.type === "text" || node.type === "inlineCode") out += node.value;
    else if ("children" in node && Array.isArray(node.children)) out += extractPlainText(node.children as PhrasingContent[]);
  }
  return out;
}

function renderHeading(node: Heading, buf: Buffer): void {
  const start = buf.text.length;
  renderInline(node.children, buf, {});
  buf.text += "\n";
  const end = buf.text.length;
  const level = Math.min(Math.max(node.depth, 1), 6) as 1 | 2 | 3 | 4 | 5 | 6;
  buf.paragraphStyles.push({ start, end, namedStyleType: `HEADING_${level}` as ParagraphStyleRange["namedStyleType"] });
}

function renderParagraph(node: Paragraph, buf: Buffer): void {
  const start = buf.text.length;
  renderInline(node.children, buf, {});
  buf.text += "\n";
  const end = buf.text.length;
  buf.paragraphStyles.push({ start, end, namedStyleType: "NORMAL_TEXT" });
}

function renderList(node: List, buf: Buffer): void {
  const preset: BulletRange["preset"] = node.ordered ? "NUMBERED_DECIMAL_ALPHA_ROMAN" : "BULLET_DISC_CIRCLE_SQUARE";
  const listStart = buf.text.length;
  for (const item of node.children) {
    renderListItem(item, buf);
  }
  const listEnd = buf.text.length;
  if (listEnd > listStart) buf.bullets.push({ start: listStart, end: listEnd, preset });
}

function renderListItem(node: ListItem, buf: Buffer): void {
  for (const child of node.children) {
    if (child.type === "paragraph") {
      const start = buf.text.length;
      renderInline(child.children, buf, {});
      buf.text += "\n";
      const end = buf.text.length;
      buf.paragraphStyles.push({ start, end, namedStyleType: "NORMAL_TEXT" });
    } else if (child.type === "list") {
      renderList(child, buf);
    }
  }
}

function renderCode(node: Code, buf: Buffer): void {
  const start = buf.text.length;
  buf.text += node.value;
  buf.text += "\n";
  const end = buf.text.length;
  buf.paragraphStyles.push({ start, end, namedStyleType: "NORMAL_TEXT" });
  buf.codeBlocks.push({ start, end, language: node.lang ?? undefined });
}

function renderBlockquote(node: Blockquote, buf: Buffer): void {
  for (const child of node.children) {
    if (child.type === "paragraph") {
      const start = buf.text.length;
      renderInline(child.children, buf, { italic: true });
      buf.text += "\n";
      const end = buf.text.length;
      buf.paragraphStyles.push({ start, end, namedStyleType: "NORMAL_TEXT" });
    } else {
      renderBlock(child, buf);
    }
  }
}

function renderThematicBreak(_node: ThematicBreak, buf: Buffer): void {
  const start = buf.text.length;
  buf.text += "────────────────────────────────────────\n";
  const end = buf.text.length;
  buf.paragraphStyles.push({ start, end, namedStyleType: "NORMAL_TEXT" });
}

function renderTable(node: Table, buf: Buffer): void {
  const rows = node.children.length;
  const cols = node.children[0]?.children.length ?? 0;
  if (rows === 0 || cols === 0) return;

  const cells: string[][] = [];
  const cellStyles: TextStyleRange[][][] = [];
  for (const row of node.children) {
    const rowCells: string[] = [];
    const rowStyles: TextStyleRange[][] = [];
    for (const cell of row.children) {
      const cellBuf = newBuffer();
      renderInline(cell.children, cellBuf, {});
      rowCells.push(cellBuf.text);
      rowStyles.push(cellBuf.textStyles);
    }
    cells.push(rowCells);
    cellStyles.push(rowStyles);
  }

  const placeholder = `\n`;
  const placeholderIndex = buf.text.length;
  buf.text += placeholder;
  buf.tables.push({ placeholderIndex, rows, cols, cells, cellStyles });
}

function renderBlock(node: RootContent, buf: Buffer): void {
  switch (node.type) {
    case "heading": return renderHeading(node, buf);
    case "paragraph": return renderParagraph(node, buf);
    case "list": return renderList(node, buf);
    case "code": return renderCode(node, buf);
    case "blockquote": return renderBlockquote(node, buf);
    case "thematicBreak": return renderThematicBreak(node, buf);
    case "table": return renderTable(node, buf);
    case "html":
      buf.text += "\n";
      return;
  }
}

export function markdownToBuffer(markdown: string): Buffer {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as Root;
  const buf = newBuffer();
  for (const node of tree.children) {
    renderBlock(node as RootContent, buf);
  }
  while (buf.text.endsWith("\n\n")) buf.text = buf.text.slice(0, -1);
  return buf;
}

function buildStyleRequests(buf: Buffer, offset: number): DocsRequest[] {
  const requests: DocsRequest[] = [];

  for (const style of buf.paragraphStyles) {
    if (style.start >= style.end) continue;
    requests.push({
      updateParagraphStyle: {
        range: { startIndex: offset + style.start, endIndex: offset + style.end },
        paragraphStyle: { namedStyleType: style.namedStyleType },
        fields: "namedStyleType",
      },
    });
  }

  for (const style of buf.textStyles) {
    if (style.start >= style.end) continue;
    const textStyle: docs_v1.Schema$TextStyle = {};
    const fields: string[] = [];
    if (style.bold) { textStyle.bold = true; fields.push("bold"); }
    if (style.italic) { textStyle.italic = true; fields.push("italic"); }
    if (style.strikethrough) { textStyle.strikethrough = true; fields.push("strikethrough"); }
    if (style.code) {
      textStyle.weightedFontFamily = { fontFamily: "Roboto Mono" };
      textStyle.backgroundColor = { color: { rgbColor: { red: 0.95, green: 0.95, blue: 0.97 } } };
      fields.push("weightedFontFamily", "backgroundColor");
    }
    if (style.link) {
      textStyle.link = { url: style.link };
      textStyle.foregroundColor = { color: { rgbColor: { red: 0.06, green: 0.37, blue: 0.78 } } };
      textStyle.underline = true;
      fields.push("link", "foregroundColor", "underline");
    }
    if (fields.length === 0) continue;
    requests.push({
      updateTextStyle: {
        range: { startIndex: offset + style.start, endIndex: offset + style.end },
        textStyle,
        fields: fields.join(","),
      },
    });
  }

  for (const code of buf.codeBlocks) {
    if (code.start >= code.end) continue;
    requests.push({
      updateTextStyle: {
        range: { startIndex: offset + code.start, endIndex: offset + code.end },
        textStyle: {
          weightedFontFamily: { fontFamily: "Roboto Mono" },
          fontSize: { magnitude: 9, unit: "PT" },
          backgroundColor: { color: { rgbColor: { red: 0.95, green: 0.95, blue: 0.97 } } },
        },
        fields: "weightedFontFamily,fontSize,backgroundColor",
      },
    });
    requests.push({
      updateParagraphStyle: {
        range: { startIndex: offset + code.start, endIndex: offset + code.end },
        paragraphStyle: {
          indentStart: { magnitude: 18, unit: "PT" },
          shading: { backgroundColor: { color: { rgbColor: { red: 0.95, green: 0.95, blue: 0.97 } } } },
        },
        fields: "indentStart,shading",
      },
    });
  }

  for (const bullet of buf.bullets) {
    if (bullet.start >= bullet.end) continue;
    requests.push({
      createParagraphBullets: {
        range: { startIndex: offset + bullet.start, endIndex: offset + bullet.end },
        bulletPreset: bullet.preset,
      },
    });
  }

  return requests;
}

async function clearDocument(docs: DocsClient, documentId: string): Promise<void> {
  const doc = await docs.documents.get({ documentId });
  const endIndex = doc.data.body?.content?.at(-1)?.endIndex ?? 1;
  if (endIndex <= 2) return;
  await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: [{ deleteContentRange: { range: { startIndex: 1, endIndex: endIndex - 1 } } }],
    },
  });
}

async function getAppendIndex(docs: DocsClient, documentId: string): Promise<number> {
  const doc = await docs.documents.get({ documentId });
  const endIndex = doc.data.body?.content?.at(-1)?.endIndex ?? 1;
  return Math.max(1, endIndex - 1);
}

async function insertTables(docs: DocsClient, documentId: string, tables: TableSpec[], baseOffset: number): Promise<void> {
  let cumulativeShift = 0;
  for (const table of tables) {
    const insertIndex = baseOffset + table.placeholderIndex + cumulativeShift;

    await docs.documents.batchUpdate({
      documentId,
      requestBody: {
        requests: [{
          insertTable: {
            location: { index: insertIndex },
            rows: table.rows,
            columns: table.cols,
          },
        }],
      },
    });

    const docAfter = await docs.documents.get({ documentId });
    const tableLoc = findTableAt(docAfter.data, insertIndex);
    if (!tableLoc) continue;
    const tableElement = tableLoc.table;

    const fillRequests: DocsRequest[] = [];
    for (let r = 0; r < table.rows; r++) {
      const row = tableElement.tableRows?.[r];
      if (!row) continue;
      for (let c = 0; c < table.cols; c++) {
        const cell = row.tableCells?.[c];
        if (!cell) continue;
        const cellStartIndex = cell.startIndex;
        if (cellStartIndex == null) continue;
        const cellText = table.cells[r]?.[c] ?? "";
        if (cellText.length > 0) {
          fillRequests.push({
            insertText: { text: cellText, location: { index: cellStartIndex + 1 } },
          });
        }
      }
    }

    if (fillRequests.length > 0) {
      const sorted = fillRequests.slice().reverse();
      await docs.documents.batchUpdate({
        documentId,
        requestBody: { requests: sorted },
      });
    }

    const docFinal = await docs.documents.get({ documentId });
    const tableFinalLoc = findTableAt(docFinal.data, insertIndex);
    if (tableFinalLoc) {
      const headerStyles: DocsRequest[] = [];
      const firstRow = tableFinalLoc.table.tableRows?.[0];
      if (firstRow) {
        for (let c = 0; c < table.cols; c++) {
          const cell = firstRow.tableCells?.[c];
          if (!cell || cell.startIndex == null) continue;
          const cellText = table.cells[0]?.[c] ?? "";
          if (cellText.length === 0) continue;
          headerStyles.push({
            updateTextStyle: {
              range: { startIndex: cell.startIndex + 1, endIndex: cell.startIndex + 1 + cellText.length },
              textStyle: { bold: true },
              fields: "bold",
            },
          });
        }
        headerStyles.push({
          updateTableCellStyle: {
            tableCellStyle: { backgroundColor: { color: { rgbColor: { red: 0.94, green: 0.94, blue: 0.96 } } } },
            fields: "backgroundColor",
            tableRange: {
              tableCellLocation: {
                tableStartLocation: { index: tableFinalLoc.startIndex },
                rowIndex: 0,
                columnIndex: 0,
              },
              rowSpan: 1,
              columnSpan: table.cols,
            },
          },
        });
      }
      if (headerStyles.length > 0) {
        await docs.documents.batchUpdate({ documentId, requestBody: { requests: headerStyles } });
      }
    }

    const docAfterFill = await docs.documents.get({ documentId });
    const endOfTable = findTableEndIndex(docAfterFill.data, insertIndex);
    if (endOfTable != null) {
      cumulativeShift += endOfTable - insertIndex;
    }
  }
}

interface TableLocation {
  table: docs_v1.Schema$Table;
  startIndex: number;
}

function findTableAt(doc: docs_v1.Schema$Document, startIndex: number): TableLocation | null {
  const content = doc.body?.content ?? [];
  for (const el of content) {
    if (el.table && el.startIndex != null) {
      if (el.startIndex === startIndex || el.startIndex === startIndex + 1) {
        return { table: el.table, startIndex: el.startIndex };
      }
    }
  }
  for (const el of content) {
    if (el.table && el.startIndex != null && el.startIndex >= startIndex - 1 && el.startIndex <= startIndex + 2) {
      return { table: el.table, startIndex: el.startIndex };
    }
  }
  return null;
}

function findTableEndIndex(doc: docs_v1.Schema$Document, startIndex: number): number | null {
  const content = doc.body?.content ?? [];
  for (const el of content) {
    if (el.table && el.startIndex != null && Math.abs(el.startIndex - startIndex) <= 2) {
      return el.endIndex ?? null;
    }
  }
  return null;
}

export interface WriteMarkdownOptions {
  mode: "append" | "replace_all";
}

export interface WriteMarkdownResult {
  insertedChars: number;
  paragraphsStyled: number;
  textRangesStyled: number;
  bulletsCreated: number;
  tablesInserted: number;
}

export async function writeMarkdown(
  docs: DocsClient,
  documentId: string,
  markdown: string,
  options: WriteMarkdownOptions,
): Promise<WriteMarkdownResult> {
  const buf = markdownToBuffer(markdown);

  if (options.mode === "replace_all") {
    await clearDocument(docs, documentId);
  }

  const offset = await getAppendIndex(docs, documentId);

  const textToInsert = buf.text;
  if (textToInsert.length > 0) {
    await docs.documents.batchUpdate({
      documentId,
      requestBody: {
        requests: [{ insertText: { text: textToInsert, location: { index: offset } } }],
      },
    });
  }

  const styleRequests = buildStyleRequests(buf, offset);
  if (styleRequests.length > 0) {
    await docs.documents.batchUpdate({
      documentId,
      requestBody: { requests: styleRequests },
    });
  }

  if (buf.tables.length > 0) {
    await insertTables(docs, documentId, buf.tables, offset);
  }

  return {
    insertedChars: textToInsert.length,
    paragraphsStyled: buf.paragraphStyles.length,
    textRangesStyled: buf.textStyles.length,
    bulletsCreated: buf.bullets.length,
    tablesInserted: buf.tables.length,
  };
}

export function _extractPlainTextForTests(nodes: PhrasingContent[]): string {
  return extractPlainText(nodes);
}
