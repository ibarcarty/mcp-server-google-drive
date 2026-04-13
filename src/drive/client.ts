import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import type { DriveClient, DocsClient, SheetsClient } from "../types.js";

export function createDriveClient(auth: OAuth2Client): DriveClient {
  return google.drive({ version: "v3", auth });
}

export function createDocsClient(auth: OAuth2Client): DocsClient {
  return google.docs({ version: "v1", auth });
}

export function createSheetsClient(auth: OAuth2Client): SheetsClient {
  return google.sheets({ version: "v4", auth });
}
