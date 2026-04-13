import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import type { DriveClient } from "../types.js";

export function createDriveClient(auth: OAuth2Client): DriveClient {
  return google.drive({ version: "v3", auth });
}
