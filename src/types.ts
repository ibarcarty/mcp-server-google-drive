import type { drive_v3, docs_v1, sheets_v4, slides_v1 } from "googleapis";

export interface Config {
  oauthCredentialsPath: string;
  tokenPath: string;
  scopes: string[];
  transport: "stdio" | "http";
  httpPort: number;
  httpHost: string;
}

export interface OAuthClientCredentials {
  installed: {
    client_id: string;
    client_secret: string;
    redirect_uris: string[];
  };
}

export interface SavedTokens {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
  token_type: string;
  scope: string;
}

export interface FileCapabilities {
  canEdit?: boolean;
  canDelete?: boolean;
  canTrash?: boolean;
  canShare?: boolean;
}

export interface FileMetadata {
  id: string;
  name: string;
  mimeType: string;
  createdTime?: string;
  modifiedTime?: string;
  size?: string;
  parents?: string[];
  webViewLink?: string;
  driveId?: string;
  trashed?: boolean;
  capabilities?: FileCapabilities;
  owners?: Array<{ displayName?: string; emailAddress?: string }>;
  lastModifyingUser?: { displayName?: string };
  shortcutDetails?: { targetId?: string; targetMimeType?: string };
  md5Checksum?: string;
}

export interface ListFilesResult {
  files: FileMetadata[];
  nextPageToken: string | null;
}

export type DriveClient = drive_v3.Drive;
export type DocsClient = docs_v1.Docs;
export type SheetsClient = sheets_v4.Sheets;
export type SlidesClient = slides_v1.Slides;
