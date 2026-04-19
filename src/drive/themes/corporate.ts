import { readFileSync, existsSync } from "node:fs";
import type { docs_v1 } from "googleapis";
import type { DocsClient } from "../../types.js";

type DocsRequest = docs_v1.Schema$Request;

export interface RGB {
  red: number;
  green: number;
  blue: number;
}

export interface ParagraphStyleSpec {
  fontSize: number;
  bold?: boolean;
  color: RGB;
  spaceAbove?: number;
  spaceBelow?: number;
}

export interface MarginsSpec {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface ThemeSpec {
  name: string;
  fontFamily: string;
  lineSpacing: number;
  margins: MarginsSpec;
  styles: {
    TITLE: ParagraphStyleSpec;
    SUBTITLE: ParagraphStyleSpec;
    HEADING_1: ParagraphStyleSpec;
    HEADING_2: ParagraphStyleSpec;
    HEADING_3: ParagraphStyleSpec;
    HEADING_4: ParagraphStyleSpec;
    HEADING_5: ParagraphStyleSpec;
    HEADING_6: ParagraphStyleSpec;
    NORMAL_TEXT: ParagraphStyleSpec;
  };
}

const TEXT_COLOR: RGB = { red: 0.18, green: 0.18, blue: 0.18 };
const CORPORATE_PRIMARY: RGB = { red: 0.03, green: 0.28, blue: 0.52 };
const CORPORATE_SECONDARY: RGB = { red: 0.16, green: 0.35, blue: 0.58 };

const CORPORATE_THEME: ThemeSpec = {
  name: "corporate",
  fontFamily: "Arial",
  lineSpacing: 115,
  margins: { top: 72, bottom: 72, left: 72, right: 72 },
  styles: {
    TITLE: { fontSize: 26, bold: true, color: CORPORATE_PRIMARY, spaceAbove: 0, spaceBelow: 12 },
    SUBTITLE: { fontSize: 16, color: TEXT_COLOR, spaceAbove: 0, spaceBelow: 12 },
    HEADING_1: { fontSize: 20, bold: true, color: CORPORATE_PRIMARY, spaceAbove: 16, spaceBelow: 6 },
    HEADING_2: { fontSize: 16, bold: true, color: CORPORATE_SECONDARY, spaceAbove: 12, spaceBelow: 4 },
    HEADING_3: { fontSize: 13, bold: true, color: CORPORATE_SECONDARY, spaceAbove: 10, spaceBelow: 4 },
    HEADING_4: { fontSize: 12, bold: true, color: TEXT_COLOR, spaceAbove: 8, spaceBelow: 2 },
    HEADING_5: { fontSize: 11, bold: true, color: TEXT_COLOR, spaceAbove: 6, spaceBelow: 2 },
    HEADING_6: { fontSize: 10, bold: true, color: TEXT_COLOR, spaceAbove: 6, spaceBelow: 2 },
    NORMAL_TEXT: { fontSize: 11, color: TEXT_COLOR, spaceAbove: 0, spaceBelow: 4 },
  },
};

const MINIMAL_THEME: ThemeSpec = {
  name: "minimal",
  fontFamily: "Inter",
  lineSpacing: 120,
  margins: { top: 72, bottom: 72, left: 72, right: 72 },
  styles: {
    TITLE: { fontSize: 24, bold: true, color: TEXT_COLOR, spaceAbove: 0, spaceBelow: 10 },
    SUBTITLE: { fontSize: 14, color: TEXT_COLOR, spaceAbove: 0, spaceBelow: 10 },
    HEADING_1: { fontSize: 18, bold: true, color: TEXT_COLOR, spaceAbove: 14, spaceBelow: 6 },
    HEADING_2: { fontSize: 14, bold: true, color: TEXT_COLOR, spaceAbove: 10, spaceBelow: 4 },
    HEADING_3: { fontSize: 12, bold: true, color: TEXT_COLOR, spaceAbove: 8, spaceBelow: 4 },
    HEADING_4: { fontSize: 11, bold: true, color: TEXT_COLOR, spaceAbove: 6, spaceBelow: 2 },
    HEADING_5: { fontSize: 11, bold: true, color: TEXT_COLOR, spaceAbove: 6, spaceBelow: 2 },
    HEADING_6: { fontSize: 11, bold: true, color: TEXT_COLOR, spaceAbove: 6, spaceBelow: 2 },
    NORMAL_TEXT: { fontSize: 11, color: TEXT_COLOR, spaceAbove: 0, spaceBelow: 4 },
  },
};

const BUILTIN_THEMES: Record<string, ThemeSpec> = {
  corporate: CORPORATE_THEME,
  minimal: MINIMAL_THEME,
};

function loadCustomThemes(): Record<string, ThemeSpec> {
  const path = process.env.GDRIVE_MCP_CUSTOM_THEMES_PATH;
  if (!path || !existsSync(path)) return {};
  try {
    const content = readFileSync(path, "utf8");
    const parsed = JSON.parse(content) as Record<string, ThemeSpec>;
    const out: Record<string, ThemeSpec> = {};
    for (const [key, spec] of Object.entries(parsed)) {
      if (spec && typeof spec === "object" && spec.styles && spec.margins) {
        out[key] = spec;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function listThemes(): string[] {
  const custom = loadCustomThemes();
  return [...Object.keys(BUILTIN_THEMES), ...Object.keys(custom)];
}

function resolveTheme(name: string): ThemeSpec | null {
  if (BUILTIN_THEMES[name]) return BUILTIN_THEMES[name];
  const custom = loadCustomThemes();
  if (custom[name]) return custom[name];
  return null;
}

export interface ApplyThemeResult {
  paragraphsStyled: number;
  theme: string;
}

export async function applyTheme(docs: DocsClient, documentId: string, themeName: string): Promise<ApplyThemeResult> {
  const theme = resolveTheme(themeName);
  if (!theme) {
    const available = listThemes();
    throw new Error(`Unknown theme: ${themeName}. Available themes: ${available.join(", ")}. Custom themes can be provided via GDRIVE_MCP_CUSTOM_THEMES_PATH env var pointing to a JSON file.`);
  }

  const doc = await docs.documents.get({ documentId });
  const content = doc.data.body?.content ?? [];

  const requests: DocsRequest[] = [];
  let paragraphsStyled = 0;

  for (const element of content) {
    if (!element.paragraph || element.startIndex == null || element.endIndex == null) continue;
    const namedStyle = (element.paragraph.paragraphStyle?.namedStyleType ?? "NORMAL_TEXT") as keyof ThemeSpec["styles"];
    const spec = theme.styles[namedStyle];
    if (!spec) continue;

    const start = element.startIndex;
    const end = element.endIndex;
    if (start >= end) continue;

    const hasCodeFont = element.paragraph.elements?.some(
      (el) => el.textRun?.textStyle?.weightedFontFamily?.fontFamily === "Roboto Mono",
    ) ?? false;

    if (!hasCodeFont) {
      requests.push({
        updateTextStyle: {
          range: { startIndex: start, endIndex: end },
          textStyle: {
            weightedFontFamily: { fontFamily: theme.fontFamily, weight: spec.bold ? 700 : 400 },
            fontSize: { magnitude: spec.fontSize, unit: "PT" },
            foregroundColor: { color: { rgbColor: spec.color } },
          },
          fields: "weightedFontFamily,fontSize,foregroundColor",
        },
      });
    }

    const paragraphStyle: docs_v1.Schema$ParagraphStyle = {};
    const fields: string[] = [];
    if (spec.spaceAbove != null) {
      paragraphStyle.spaceAbove = { magnitude: spec.spaceAbove, unit: "PT" };
      fields.push("spaceAbove");
    }
    if (spec.spaceBelow != null) {
      paragraphStyle.spaceBelow = { magnitude: spec.spaceBelow, unit: "PT" };
      fields.push("spaceBelow");
    }
    paragraphStyle.lineSpacing = theme.lineSpacing;
    fields.push("lineSpacing");

    requests.push({
      updateParagraphStyle: {
        range: { startIndex: start, endIndex: end },
        paragraphStyle,
        fields: fields.join(","),
      },
    });

    paragraphsStyled++;
  }

  requests.push({
    updateDocumentStyle: {
      documentStyle: {
        marginTop: { magnitude: theme.margins.top, unit: "PT" },
        marginBottom: { magnitude: theme.margins.bottom, unit: "PT" },
        marginLeft: { magnitude: theme.margins.left, unit: "PT" },
        marginRight: { magnitude: theme.margins.right, unit: "PT" },
      },
      fields: "marginTop,marginBottom,marginLeft,marginRight",
    },
  });

  if (requests.length > 0) {
    await docs.documents.batchUpdate({ documentId, requestBody: { requests } });
  }

  return { paragraphsStyled, theme: theme.name };
}
