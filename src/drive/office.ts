// Office file conversion (defect found 2026-08-11): .docx/.xlsx/.pptx read through
// alt=media used to be decoded as UTF-8, producing irreversible U+FFFD output.
// Drive cannot export Office formats directly, but it CAN convert them on copy;
// so: copy to the Google equivalent → export as text → delete the copy.
import type { DriveClient } from "../types.js";
import { exportWorkspaceFile, resolveExportMimeType } from "./export.js";
import { isTextualMime } from "./content-type.js";

const GOOGLE_DOC = "application/vnd.google-apps.document";
const GOOGLE_SHEET = "application/vnd.google-apps.spreadsheet";
const GOOGLE_SLIDES = "application/vnd.google-apps.presentation";

const OFFICE_IMPORT_TARGETS: Record<string, string> = {
  // Word processing
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": GOOGLE_DOC,
  "application/msword": GOOGLE_DOC,
  "application/vnd.oasis.opendocument.text": GOOGLE_DOC,
  "application/rtf": GOOGLE_DOC,
  "text/rtf": GOOGLE_DOC,
  // Spreadsheets
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": GOOGLE_SHEET,
  "application/vnd.ms-excel": GOOGLE_SHEET,
  "application/vnd.oasis.opendocument.spreadsheet": GOOGLE_SHEET,
  // Presentations
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": GOOGLE_SLIDES,
  "application/vnd.ms-powerpoint": GOOGLE_SLIDES,
  "application/vnd.oasis.opendocument.presentation": GOOGLE_SLIDES,
};

export function officeImportTarget(mimeType: string): string | null {
  return OFFICE_IMPORT_TARGETS[mimeType.toLowerCase()] ?? null;
}

export interface OfficeConversionResult {
  content: string;
  exportMime: string;
  cleanupWarning?: string;
}

/**
 * Converts an Office file to text by copying it as its Google Workspace
 * equivalent (the copy lands in the caller's My Drive root, so it works even
 * for files in read-only shared drives) and exporting that copy. The copy is
 * always deleted, including when the export fails.
 */
export async function convertOfficeFile(
  drive: DriveClient,
  fileId: string,
  sourceMimeType: string,
  exportFormat?: string,
): Promise<OfficeConversionResult> {
  const target = officeImportTarget(sourceMimeType);
  if (!target) {
    throw new Error(`Not a convertible Office type: ${sourceMimeType}`);
  }
  const exportMime = resolveExportMimeType(target, exportFormat);
  if (!isTextualMime(exportMime)) {
    throw new Error(
      `Export format "${exportFormat}" is binary (${exportMime}) and cannot be returned inline. Use a text format instead.`,
    );
  }

  const rootRes = await drive.files.get({ fileId: "root", fields: "id" });
  const rootId = rootRes.data.id ?? "root";

  const copy = await drive.files.copy({
    fileId,
    requestBody: {
      mimeType: target,
      name: `[tmp-mcp-conversion] ${fileId}`,
      parents: [rootId],
    },
    supportsAllDrives: true,
    fields: "id",
  });
  const tmpId = copy.data.id;
  if (!tmpId) {
    throw new Error("Conversion copy did not return a file ID");
  }

  let content: string;
  let cleanupWarning: string | undefined;
  try {
    content = await exportWorkspaceFile(drive, tmpId, exportMime);
  } finally {
    try {
      await drive.files.delete({ fileId: tmpId, supportsAllDrives: true });
    } catch {
      cleanupWarning = `Warning: the temporary conversion copy could not be deleted (ID: ${tmpId}). You may remove it manually from My Drive.`;
    }
  }

  return { content, exportMime, cleanupWarning };
}
