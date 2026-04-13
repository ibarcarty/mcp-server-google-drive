import type { DriveClient } from "../types.js";

const EXPORT_MIME_MAP: Record<string, Record<string, string>> = {
  "application/vnd.google-apps.document": {
    markdown: "text/markdown",
    text: "text/plain",
    html: "text/html",
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    default: "text/markdown",
  },
  "application/vnd.google-apps.spreadsheet": {
    csv: "text/csv",
    tsv: "text/tab-separated-values",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pdf: "application/pdf",
    default: "text/csv",
  },
  "application/vnd.google-apps.presentation": {
    text: "text/plain",
    pdf: "application/pdf",
    default: "text/plain",
  },
  "application/vnd.google-apps.drawing": {
    png: "image/png",
    svg: "image/svg+xml",
    pdf: "application/pdf",
    default: "image/png",
  },
};

export function isWorkspaceFile(mimeType: string): boolean {
  return mimeType.startsWith("application/vnd.google-apps.");
}

export function resolveExportMimeType(workspaceMimeType: string, requestedFormat?: string): string {
  const mapping = EXPORT_MIME_MAP[workspaceMimeType];
  if (!mapping) {
    return "application/pdf";
  }
  if (requestedFormat && mapping[requestedFormat]) {
    return mapping[requestedFormat];
  }
  return mapping.default;
}

export function getAvailableFormats(workspaceMimeType: string): string[] {
  const mapping = EXPORT_MIME_MAP[workspaceMimeType];
  if (!mapping) return [];
  return Object.keys(mapping).filter((k) => k !== "default");
}

export async function exportWorkspaceFile(
  drive: DriveClient,
  fileId: string,
  exportMimeType: string,
): Promise<string> {
  const res = await drive.files.export(
    { fileId, mimeType: exportMimeType },
    { responseType: "text" },
  );
  return res.data as string;
}
