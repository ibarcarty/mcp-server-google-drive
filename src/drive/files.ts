import { Readable } from "node:stream";
import type { DriveClient, ListFilesResult, FileMetadata } from "../types.js";

const FILE_FIELDS = "id, name, mimeType, modifiedTime, size, parents, webViewLink";

function escapeQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// --- List ---

export async function listFiles(
  drive: DriveClient,
  params: {
    folderId?: string;
    pageSize?: number;
    pageToken?: string;
    mimeType?: string;
    orderBy?: string;
    includeSharedDrives?: boolean;
  },
): Promise<ListFilesResult> {
  const queryParts: string[] = ["trashed = false"];
  if (params.folderId) queryParts.push(`'${escapeQuery(params.folderId)}' in parents`);
  if (params.mimeType) queryParts.push(`mimeType = '${escapeQuery(params.mimeType)}'`);

  const includeShared = params.includeSharedDrives !== false;

  const res = await drive.files.list({
    q: queryParts.join(" and "),
    pageSize: params.pageSize ?? 20,
    pageToken: params.pageToken,
    orderBy: params.orderBy ?? "modifiedTime desc",
    fields: `nextPageToken, files(${FILE_FIELDS})`,
    supportsAllDrives: includeShared,
    includeItemsFromAllDrives: includeShared,
    corpora: includeShared ? "allDrives" : "user",
  });

  return {
    files: (res.data.files ?? []) as FileMetadata[],
    nextPageToken: res.data.nextPageToken ?? null,
  };
}

// --- Search ---

export async function searchFiles(
  drive: DriveClient,
  params: {
    query: string;
    searchIn?: "fullText" | "name";
    mimeType?: string;
    pageSize?: number;
    pageToken?: string;
    includeSharedDrives?: boolean;
  },
): Promise<ListFilesResult> {
  const escaped = escapeQuery(params.query);
  const searchField = params.searchIn === "name" ? "name" : "fullText";
  const queryParts: string[] = [
    `${searchField} contains '${escaped}'`,
    "trashed = false",
  ];
  if (params.mimeType) queryParts.push(`mimeType = '${escapeQuery(params.mimeType)}'`);

  const includeShared = params.includeSharedDrives !== false;

  const res = await drive.files.list({
    q: queryParts.join(" and "),
    pageSize: params.pageSize ?? 20,
    pageToken: params.pageToken,
    fields: `nextPageToken, files(${FILE_FIELDS})`,
    supportsAllDrives: includeShared,
    includeItemsFromAllDrives: includeShared,
    corpora: includeShared ? "allDrives" : "user",
  });

  return {
    files: (res.data.files ?? []) as FileMetadata[],
    nextPageToken: res.data.nextPageToken ?? null,
  };
}

// --- Get metadata ---

export async function getFileMetadata(
  drive: DriveClient,
  fileId: string,
): Promise<FileMetadata> {
  const res = await drive.files.get({
    fileId,
    fields: FILE_FIELDS,
    supportsAllDrives: true,
  });
  return res.data as FileMetadata;
}

// --- Read content ---

/** Default window per read: keeps MCP responses well below transport limits. */
export const DEFAULT_MAX_BYTES = 200_000;
/** Hard ceiling per read, regardless of what the caller asks for. */
export const MAX_READ_BYTES = 2_000_000;

function toBuffer(data: unknown): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data));
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (typeof data === "string") return Buffer.from(data, "utf8");
  return Buffer.from(String(data), "utf8");
}

/**
 * Reads a byte range of a file. Never downloads the whole file: a 90MB file
 * fetched with alt=media and no Range crashed the stdio transport (2026-08-11),
 * so every read goes through an explicit window.
 */
export async function readFileBytes(
  drive: DriveClient,
  fileId: string,
  range?: { offset?: number; maxBytes?: number },
): Promise<Buffer> {
  const offset = Math.max(0, Math.floor(range?.offset ?? 0));
  const maxBytes = Math.min(
    Math.max(1, Math.floor(range?.maxBytes ?? DEFAULT_MAX_BYTES)),
    MAX_READ_BYTES,
  );
  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    {
      responseType: "arraybuffer",
      headers: { Range: `bytes=${offset}-${offset + maxBytes - 1}` },
    },
  );
  return toBuffer(res.data);
}

// --- Create ---

export async function createFile(
  drive: DriveClient,
  params: {
    name: string;
    content?: string;
    mimeType?: string;
    parentFolderId?: string;
  },
): Promise<FileMetadata> {
  const requestBody: Record<string, unknown> = { name: params.name };
  if (params.mimeType) requestBody.mimeType = params.mimeType;
  if (params.parentFolderId) requestBody.parents = [params.parentFolderId];

  const options: Record<string, unknown> = {
    requestBody,
    fields: FILE_FIELDS,
    supportsAllDrives: true,
  };

  if (params.content !== undefined) {
    options.media = {
      mimeType: params.mimeType ?? "text/plain",
      body: Readable.from([params.content]),
    };
  }

  const res = await drive.files.create(options);
  return res.data as FileMetadata;
}

// --- Create folder ---

export async function createFolder(
  drive: DriveClient,
  params: {
    name: string;
    parentFolderId?: string;
  },
): Promise<FileMetadata> {
  const requestBody: Record<string, unknown> = {
    name: params.name,
    mimeType: "application/vnd.google-apps.folder",
  };
  if (params.parentFolderId) requestBody.parents = [params.parentFolderId];

  const res = await drive.files.create({
    requestBody,
    fields: FILE_FIELDS,
    supportsAllDrives: true,
  });
  return res.data as FileMetadata;
}

// --- Update ---

export async function updateFile(
  drive: DriveClient,
  params: {
    fileId: string;
    name?: string;
    content?: string;
    mimeType?: string;
  },
): Promise<FileMetadata> {
  const requestBody: Record<string, unknown> = {};
  if (params.name) requestBody.name = params.name;

  const options: Record<string, unknown> = {
    fileId: params.fileId,
    requestBody,
    fields: FILE_FIELDS,
    supportsAllDrives: true,
  };

  if (params.content !== undefined) {
    options.media = {
      mimeType: params.mimeType ?? "text/plain",
      body: Readable.from([params.content]),
    };
  }

  const res = await drive.files.update(options);
  return res.data as FileMetadata;
}

// --- Delete ---

/**
 * Metadata needed to delete safely. Verified live (2026-08-12): the Drive API
 * answers 404 "File not found" — not 403 — when a non-organizer attempts a
 * permanent delete in a shared drive, with or without supportsAllDrives, so
 * capabilities must be checked up front.
 */
export async function getFileForDelete(
  drive: DriveClient,
  fileId: string,
): Promise<FileMetadata> {
  const res = await drive.files.get({
    fileId,
    fields: "id, name, mimeType, driveId, capabilities(canDelete, canTrash)",
    supportsAllDrives: true,
  });
  return res.data as FileMetadata;
}

export async function deleteFile(
  drive: DriveClient,
  fileId: string,
): Promise<void> {
  await drive.files.delete({
    fileId,
    supportsAllDrives: true,
  });
}

export async function trashFile(
  drive: DriveClient,
  fileId: string,
): Promise<void> {
  await drive.files.update({
    fileId,
    requestBody: { trashed: true },
    supportsAllDrives: true,
  });
}

export function isNotFoundError(err: unknown): boolean {
  const code = (err as { code?: number | string } | null)?.code;
  return code === 404 || code === "404";
}

// --- Move ---

export async function moveFile(
  drive: DriveClient,
  params: {
    fileId: string;
    destinationFolderId: string;
  },
): Promise<FileMetadata> {
  // Get current parents first
  const current = await drive.files.get({
    fileId: params.fileId,
    fields: "parents",
    supportsAllDrives: true,
  });
  const previousParents = (current.data.parents ?? []).join(",");

  const res = await drive.files.update({
    fileId: params.fileId,
    addParents: params.destinationFolderId,
    removeParents: previousParents,
    fields: FILE_FIELDS,
    supportsAllDrives: true,
  });
  return res.data as FileMetadata;
}

// --- File info (extended metadata) ---

const INFO_FIELDS =
  "id, name, mimeType, size, createdTime, modifiedTime, parents, webViewLink, trashed, " +
  "driveId, owners(displayName, emailAddress), lastModifyingUser(displayName), " +
  "shortcutDetails(targetId, targetMimeType), capabilities(canEdit, canDelete, canTrash, canShare), md5Checksum";

export interface ResolvedParent {
  id: string;
  name: string;
}

export interface FileInfo {
  file: FileMetadata;
  parents: ResolvedParent[];
  sharedDrive?: { id: string; name: string };
}

/**
 * Extended metadata for one item, with parents resolved to their names and
 * the shared drive identified — the lookup that was impossible through the
 * tool surface until v1.2.0 (defect 4).
 */
export async function getFileInfo(
  drive: DriveClient,
  fileId: string,
): Promise<FileInfo> {
  const res = await drive.files.get({
    fileId,
    fields: INFO_FIELDS,
    supportsAllDrives: true,
  });
  const file = res.data as FileMetadata;

  const parents: ResolvedParent[] = [];
  for (const parentId of file.parents ?? []) {
    try {
      const parent = await drive.files.get({
        fileId: parentId,
        fields: "id, name",
        supportsAllDrives: true,
      });
      parents.push({ id: parentId, name: parent.data.name ?? "(unknown)" });
    } catch {
      parents.push({ id: parentId, name: "(inaccessible)" });
    }
  }

  let sharedDrive: FileInfo["sharedDrive"];
  if (file.driveId) {
    try {
      const d = await drive.drives.get({ driveId: file.driveId, fields: "id, name" });
      sharedDrive = { id: file.driveId, name: d.data.name ?? file.driveId };
    } catch {
      sharedDrive = { id: file.driveId, name: "(name unavailable)" };
    }
  }

  return { file, parents, sharedDrive };
}

// --- Copy ---

export async function copyFile(
  drive: DriveClient,
  params: {
    fileId: string;
    name?: string;
    destinationFolderId?: string;
  },
): Promise<FileMetadata> {
  const requestBody: Record<string, unknown> = {};
  if (params.name) requestBody.name = params.name;
  if (params.destinationFolderId) requestBody.parents = [params.destinationFolderId];

  const res = await drive.files.copy({
    fileId: params.fileId,
    requestBody,
    fields: FILE_FIELDS,
    supportsAllDrives: true,
  });
  return res.data as FileMetadata;
}
