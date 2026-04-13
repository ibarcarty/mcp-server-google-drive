import type { drive_v3 } from "googleapis";

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

export interface FileMetadata {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
  parents?: string[];
  webViewLink?: string;
}

export interface ListFilesResult {
  files: FileMetadata[];
  nextPageToken: string | null;
}

export type DriveClient = drive_v3.Drive;
