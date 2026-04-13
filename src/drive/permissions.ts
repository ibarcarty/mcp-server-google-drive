import type { DriveClient } from "../types.js";

export interface Permission {
  id: string;
  type: string;
  role: string;
  emailAddress?: string;
  displayName?: string;
}

export async function shareFile(
  drive: DriveClient,
  params: {
    fileId: string;
    email: string;
    role: "reader" | "writer" | "commenter";
    sendNotification?: boolean;
  },
): Promise<Permission> {
  const res = await drive.permissions.create({
    fileId: params.fileId,
    requestBody: {
      type: "user",
      role: params.role,
      emailAddress: params.email,
    },
    sendNotificationEmail: params.sendNotification ?? false,
    supportsAllDrives: true,
    fields: "id, type, role, emailAddress, displayName",
  });
  return res.data as Permission;
}

export async function listPermissions(
  drive: DriveClient,
  fileId: string,
): Promise<Permission[]> {
  const res = await drive.permissions.list({
    fileId,
    supportsAllDrives: true,
    fields: "permissions(id, type, role, emailAddress, displayName)",
  });
  return (res.data.permissions ?? []) as Permission[];
}

export async function removePermission(
  drive: DriveClient,
  params: {
    fileId: string;
    permissionId: string;
  },
): Promise<void> {
  await drive.permissions.delete({
    fileId: params.fileId,
    permissionId: params.permissionId,
    supportsAllDrives: true,
  });
}
