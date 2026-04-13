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

export async function readFileContent(
  drive: DriveClient,
  fileId: string,
): Promise<string> {
  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "text" },
  );
  return res.data as string;
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

export async function deleteFile(
  drive: DriveClient,
  fileId: string,
): Promise<void> {
  await drive.files.delete({
    fileId,
    supportsAllDrives: true,
  });
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
