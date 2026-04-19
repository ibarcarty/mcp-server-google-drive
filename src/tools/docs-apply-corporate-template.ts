import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DocsClient } from "../types.js";
import { applyCorporateTemplate } from "../drive/corporate-template.js";

const changeLogEntrySchema = z.object({
  version: z.string(),
  date: z.string(),
  author: z.string(),
  description: z.string(),
});

const inputSchema = {
  documentId: z.string().describe("The ID of the Google Doc to apply the template to. Warning: this clears existing content before inserting the template."),
  title: z.string().describe("Document title (rendered as H1)."),
  projectCode: z.string().optional().describe("Optional project code (rendered as H2 under the title)."),
  version: z.string().describe("Document version, e.g. '1.0'."),
  date: z.string().describe("Document date in ISO format (YYYY-MM-DD) or any human-readable format."),
  author: z.string().describe("Document author name."),
  classification: z.enum(["PUBLIC", "INTERNAL", "CONFIDENTIAL"]).describe("Data classification level. Will be shown prominently in the metadata section and in the document footer."),
  organization: z.string().optional().describe("Organization name (optional)."),
  footerText: z.string().optional().describe("Custom footer text. If omitted, the footer will be auto-generated as 'CLASSIFICATION — ORGANIZATION'."),
  changeLog: z.array(changeLogEntrySchema).optional().describe("Array of change log entries. If omitted, an initial entry is auto-generated from the current version, date, and author."),
  includeTocPlaceholder: z.boolean().optional().describe("Whether to include a placeholder pointing to Google Docs' built-in TOC insertion (default: true)."),
};

export function registerDocsApplyCorporateTemplateTool(server: McpServer, docs: DocsClient): void {
  server.tool(
    "docs_apply_corporate_template",
    "Initialize a Google Doc with a standard corporate template: title, metadata block (version, date, author, classification), change log table, TOC placeholder, and a page footer displaying the classification. Pair with docs_write_markdown to add the actual content after the template, then docs_apply_theme for consistent styling.",
    inputSchema,
    async (args) => {
      try {
        const result = await applyCorporateTemplate(docs, args.documentId, {
          title: args.title,
          projectCode: args.projectCode,
          version: args.version,
          date: args.date,
          author: args.author,
          classification: args.classification,
          organization: args.organization,
          footerText: args.footerText,
          changeLog: args.changeLog,
          includeTocPlaceholder: args.includeTocPlaceholder,
        });
        return {
          content: [{
            type: "text" as const,
            text: `Corporate template applied to document ${args.documentId}. Classification: ${result.classification}. Footer applied: ${result.footerApplied}. Next step: call docs_write_markdown with mode='append' to add the document body, then docs_apply_theme to apply the visual theme.`,
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: "text" as const,
            text: `Error applying corporate template: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    },
  );
}
