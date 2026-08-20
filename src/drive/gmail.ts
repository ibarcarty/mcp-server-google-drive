import type { GmailClient } from "../types.js";

// RED LINE (owner rule, 2026-07-18): this module creates DRAFTS only. It must
// never gain a send capability — sending email is always a human action taken
// in the Gmail UI. The gmail.compose scope technically allows sending; the
// guarantee lives here: no function in this server calls drafts.send or
// messages.send, and the contract tests enforce it.

export interface DraftInput {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
}

/** Reject CR/LF in header values — classic email header injection vector. */
function headerValue(name: string, value: string): string {
  if (/[\r\n]/.test(value)) {
    throw new Error(`Invalid ${name}: header values must not contain line breaks.`);
  }
  return value;
}

/** RFC 2047 encoded-word for non-ASCII header text (UTF-8, base64). */
function encodeHeaderText(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/**
 * Build a complete RFC 2822 message (UTF-8 subject and body, base64 body
 * transfer encoding) and return it base64url-encoded, as the Gmail API's
 * `raw` field expects.
 */
export function buildRawMessage(input: DraftInput): string {
  const lines = [
    `To: ${headerValue("to", input.to)}`,
    ...(input.cc !== undefined ? [`Cc: ${headerValue("cc", input.cc)}`] : []),
    ...(input.bcc !== undefined ? [`Bcc: ${headerValue("bcc", input.bcc)}`] : []),
    `Subject: ${encodeHeaderText(headerValue("subject", input.subject))}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(input.body, "utf8").toString("base64"),
  ];
  return Buffer.from(lines.join("\r\n"), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export interface CreatedDraft {
  id: string;
  messageId?: string;
}

/** Create a draft in the authenticated user's mailbox. Never sends. */
export async function createDraft(gmail: GmailClient, raw: string): Promise<CreatedDraft> {
  const res = await gmail.users.drafts.create({
    userId: "me",
    requestBody: { message: { raw } },
  });
  return { id: res.data.id ?? "", messageId: res.data.message?.id ?? undefined };
}

/**
 * Format a Gmail API error for the tool response. A 403 for missing scopes
 * gets an actionable hint: the saved token predates the gmail.compose scope.
 */
export function gmailErrorMessage(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: number }).code;
  const reasons = ((error as { errors?: Array<{ reason?: string }> }).errors ?? [])
    .map((e) => e.reason)
    .filter(Boolean);
  if (code === 403 && (reasons.includes("insufficientPermissions") || /insufficient.*scope/i.test(msg))) {
    return (
      `${msg}\n` +
      `The saved OAuth token does not include the Gmail compose scope. ` +
      `Re-run the auth flow to grant it (node dist/index.js auth, or npx @ibarcarty/mcp-server-google-drive auth) ` +
      `and make sure the Gmail API is enabled in your GCP project.`
    );
  }
  return msg;
}
