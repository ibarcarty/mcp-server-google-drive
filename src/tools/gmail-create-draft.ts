import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GmailClient } from "../types.js";
import { buildRawMessage, createDraft, gmailErrorMessage } from "../drive/gmail.js";

const inputSchema = {
  to: z.string().describe("Recipient address(es), comma-separated."),
  subject: z.string().describe("Email subject (UTF-8 safe)."),
  body: z.string().describe("Plain-text body (UTF-8)."),
  cc: z.string().optional().describe("Cc address(es), comma-separated."),
  bcc: z.string().optional().describe("Bcc address(es), comma-separated."),
};

export function registerGmailCreateDraftTool(server: McpServer, gmail: GmailClient): void {
  server.tool(
    "gmail_create_draft",
    "Create a DRAFT email in the authenticated user's Gmail Drafts folder. This tool never sends anything: the user reviews the draft in Gmail and presses Send themselves. There is deliberately no send tool in this server.",
    inputSchema,
    async (args) => {
      try {
        const raw = buildRawMessage({
          to: args.to,
          subject: args.subject,
          body: args.body,
          ...(args.cc !== undefined && { cc: args.cc }),
          ...(args.bcc !== undefined && { bcc: args.bcc }),
        });
        const draft = await createDraft(gmail, raw);
        return {
          content: [{
            type: "text" as const,
            text:
              `Draft created (NOT sent - review and send it yourself in Gmail).\n` +
              `Draft ID: ${draft.id}\nTo: ${args.to}\nSubject: ${args.subject}`,
          }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error creating draft: ${gmailErrorMessage(error)}` }],
          isError: true,
        };
      }
    },
  );
}
