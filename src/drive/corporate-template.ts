import type { docs_v1 } from "googleapis";
import type { DocsClient } from "../types.js";
import { writeMarkdown } from "./markdown-to-docs.js";

type DocsRequest = docs_v1.Schema$Request;

export type Classification = "PUBLIC" | "INTERNAL" | "CONFIDENTIAL";

export interface ChangeLogEntry {
  version: string;
  date: string;
  author: string;
  description: string;
}

export interface CorporateTemplateOptions {
  title: string;
  projectCode?: string;
  version: string;
  date: string;
  author: string;
  classification: Classification;
  organization?: string;
  footerText?: string;
  changeLog?: ChangeLogEntry[];
  includeTocPlaceholder?: boolean;
}

function escapeMarkdown(s: string): string {
  return s.replace(/\|/g, "\\|");
}

function buildTemplateMarkdown(opts: CorporateTemplateOptions): string {
  const lines: string[] = [];

  lines.push(`# ${opts.title}`);
  if (opts.projectCode) lines.push(`## ${opts.projectCode}`);
  lines.push("");

  lines.push(`**Clasificación:** ${opts.classification}`);
  lines.push("");

  lines.push("### Metadatos");
  lines.push("");
  lines.push("| Campo | Valor |");
  lines.push("|-------|-------|");
  lines.push(`| Versión | ${escapeMarkdown(opts.version)} |`);
  lines.push(`| Fecha | ${escapeMarkdown(opts.date)} |`);
  lines.push(`| Autor | ${escapeMarkdown(opts.author)} |`);
  if (opts.organization) lines.push(`| Organización | ${escapeMarkdown(opts.organization)} |`);
  if (opts.projectCode) lines.push(`| Código de proyecto | ${escapeMarkdown(opts.projectCode)} |`);
  lines.push(`| Clasificación | ${opts.classification} |`);
  lines.push("");

  lines.push("### Control de cambios");
  lines.push("");
  const log = opts.changeLog && opts.changeLog.length > 0 ? opts.changeLog : [{
    version: opts.version,
    date: opts.date,
    author: opts.author,
    description: "Versión inicial",
  }];
  lines.push("| Versión | Fecha | Autor | Descripción |");
  lines.push("|---------|-------|-------|-------------|");
  for (const entry of log) {
    lines.push(`| ${escapeMarkdown(entry.version)} | ${escapeMarkdown(entry.date)} | ${escapeMarkdown(entry.author)} | ${escapeMarkdown(entry.description)} |`);
  }
  lines.push("");

  if (opts.includeTocPlaceholder !== false) {
    lines.push("### Índice");
    lines.push("");
    lines.push("*(Generar desde el menú: Insertar → Tabla de contenidos)*");
    lines.push("");
  }

  lines.push("---");
  lines.push("");

  return lines.join("\n");
}

export interface ApplyTemplateResult {
  templateSectionsInserted: number;
  footerApplied: boolean;
  classification: Classification;
}

export async function applyCorporateTemplate(
  docs: DocsClient,
  documentId: string,
  options: CorporateTemplateOptions,
): Promise<ApplyTemplateResult> {
  const templateMarkdown = buildTemplateMarkdown(options);
  const writeResult = await writeMarkdown(docs, documentId, templateMarkdown, { mode: "replace_all" });

  let footerApplied = false;
  try {
    const footerText = options.footerText ?? `${options.classification} — ${options.organization ?? ""}`.trim().replace(/\s+—\s+$/, "");
    await applyFooterWithClassification(docs, documentId, footerText);
    footerApplied = true;
  } catch {
    footerApplied = false;
  }

  return {
    templateSectionsInserted: Math.min(writeResult.paragraphsStyled, 4),
    footerApplied,
    classification: options.classification,
  };
}

async function applyFooterWithClassification(docs: DocsClient, documentId: string, footerText: string): Promise<void> {
  const createFooterRes = await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: [{
        createFooter: { type: "DEFAULT" },
      }],
    },
  });

  const footerId = createFooterRes.data.replies?.[0]?.createFooter?.footerId;
  if (!footerId) return;

  const doc = await docs.documents.get({ documentId });
  const footer = doc.data.footers?.[footerId];
  const footerStartIndex = footer?.content?.[0]?.startIndex ?? 0;

  const requests: DocsRequest[] = [
    {
      insertText: {
        text: footerText,
        location: { segmentId: footerId, index: footerStartIndex },
      },
    },
    {
      updateTextStyle: {
        range: {
          segmentId: footerId,
          startIndex: footerStartIndex,
          endIndex: footerStartIndex + footerText.length,
        },
        textStyle: {
          fontSize: { magnitude: 9, unit: "PT" },
          foregroundColor: { color: { rgbColor: { red: 0.4, green: 0.4, blue: 0.4 } } },
        },
        fields: "fontSize,foregroundColor",
      },
    },
  ];

  await docs.documents.batchUpdate({ documentId, requestBody: { requests } });
}
