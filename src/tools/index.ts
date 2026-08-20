import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DriveClient, DocsClient, SheetsClient, SlidesClient, CalendarClient, GmailClient } from "../types.js";
import { registerListFilesTool } from "./list-files.js";
import { registerSearchTool } from "./search-files.js";
import { registerReadFileTool } from "./read-file.js";
import { registerGetFileInfoTool } from "./file-info.js";
import { registerCreateFileTool } from "./create-file.js";
import { registerCreateFolderTool } from "./create-folder.js";
import { registerUpdateFileTool } from "./update-file.js";
import { registerDeleteFileTool } from "./delete-file.js";
import { registerMoveFileTool } from "./move-file.js";
import { registerCopyFileTool } from "./copy-file.js";
import { registerShareFileTool } from "./share-file.js";
import { registerListPermissionsTool } from "./list-permissions.js";
import { registerRemovePermissionTool } from "./remove-permission.js";
import { registerDocsReadTool } from "./docs-read.js";
import { registerDocsAppendTool } from "./docs-append.js";
import { registerDocsInsertTool } from "./docs-insert.js";
import { registerDocsReplaceTool } from "./docs-replace.js";
import { registerDocsWriteMarkdownTool } from "./docs-write-markdown.js";
import { registerDocsApplyThemeTool } from "./docs-apply-theme.js";
import { registerDocsApplyCorporateTemplateTool } from "./docs-apply-corporate-template.js";
import { registerSheetsReadTool } from "./sheets-read.js";
import { registerSheetsWriteTool } from "./sheets-write.js";
import { registerSheetsAppendTool } from "./sheets-append.js";
import { registerSheetsClearTool } from "./sheets-clear.js";
import { registerSlidesReadTool } from "./slides-read.js";
import { registerSlidesAddSlideTool } from "./slides-add-slide.js";
import { registerSlidesAddTextTool } from "./slides-add-text.js";
import { registerSlidesReplaceTool } from "./slides-replace.js";
import { registerCalendarListEventsTool } from "./calendar-list.js";
import { registerCalendarCreateEventTool } from "./calendar-create.js";
import { registerCalendarUpdateEventTool } from "./calendar-update.js";
import { registerCalendarDeleteEventTool } from "./calendar-delete.js";
import { registerGmailCreateDraftTool } from "./gmail-create-draft.js";

export function registerAllTools(
  server: McpServer,
  drive: DriveClient,
  docs: DocsClient,
  sheets: SheetsClient,
  slides: SlidesClient,
  calendar: CalendarClient,
  gmail: GmailClient,
): void {
  // Drive — Read operations
  registerListFilesTool(server, drive);
  registerSearchTool(server, drive);
  registerReadFileTool(server, drive);
  registerGetFileInfoTool(server, drive);

  // Drive — Write operations
  registerCreateFileTool(server, drive);
  registerCreateFolderTool(server, drive);
  registerUpdateFileTool(server, drive);
  registerDeleteFileTool(server, drive);
  registerMoveFileTool(server, drive);
  registerCopyFileTool(server, drive);

  // Drive — Permissions
  registerShareFileTool(server, drive);
  registerListPermissionsTool(server, drive);
  registerRemovePermissionTool(server, drive);

  // Google Docs
  registerDocsReadTool(server, docs);
  registerDocsAppendTool(server, docs);
  registerDocsInsertTool(server, docs);
  registerDocsReplaceTool(server, docs);
  registerDocsWriteMarkdownTool(server, docs);
  registerDocsApplyThemeTool(server, docs);
  registerDocsApplyCorporateTemplateTool(server, docs);

  // Google Sheets
  registerSheetsReadTool(server, sheets);
  registerSheetsWriteTool(server, sheets);
  registerSheetsAppendTool(server, sheets);
  registerSheetsClearTool(server, sheets);

  // Google Slides
  registerSlidesReadTool(server, slides);
  registerSlidesAddSlideTool(server, slides);
  registerSlidesAddTextTool(server, slides);
  registerSlidesReplaceTool(server, slides);

  // Google Calendar
  registerCalendarListEventsTool(server, calendar);
  registerCalendarCreateEventTool(server, calendar);
  registerCalendarUpdateEventTool(server, calendar);
  registerCalendarDeleteEventTool(server, calendar);

  // Gmail — drafts ONLY (red line: this server never sends email)
  registerGmailCreateDraftTool(server, gmail);
}
