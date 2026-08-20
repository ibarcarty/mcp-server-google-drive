// Contract tests for the Gmail draft tool (v1.4.0):
//  - gmail_create_draft builds an RFC 2822 message (UTF-8 safe headers and
//    body), base64url-encodes it and creates a DRAFT via users.drafts.create.
//  - RED LINE (owner rule, 2026-07-18): the server NEVER sends email. The
//    mock throws if anything touches drafts.send / messages.send, and the
//    suite asserts zero send calls in every scenario.
//  - API errors surface as isError; an insufficient-scope 403 tells the user
//    to re-run the auth flow (token predates the gmail.compose scope).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { registerGmailCreateDraftTool } from "../../src/tools/gmail-create-draft.js";
import { buildRawMessage } from "../../src/drive/gmail.js";
import { captureToolHandler, textOf, makeApiError } from "./helpers.js";

interface GmailMockCalls {
  draftCreates: Array<Record<string, unknown>>;
  sendAttempts: number;
}

function makeGmailMock(opts: { createError?: Error } = {}) {
  const calls: GmailMockCalls = { draftCreates: [], sendAttempts: 0 };
  const gmail = {
    users: {
      drafts: {
        async create(params: Record<string, unknown>) {
          calls.draftCreates.push(params);
          if (opts.createError) throw opts.createError;
          return { data: { id: "draft-1", message: { id: "msg-1" } } };
        },
        async send() {
          calls.sendAttempts += 1;
          throw new Error("RED LINE VIOLATED: drafts.send must never be called");
        },
      },
      messages: {
        async send() {
          calls.sendAttempts += 1;
          throw new Error("RED LINE VIOLATED: messages.send must never be called");
        },
      },
    },
  };
  return { gmail, calls };
}

function decodeRaw(raw: string): string {
  return Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

describe("buildRawMessage", () => {
  it("builds an RFC 2822 message with To/Subject/MIME headers and UTF-8 body", () => {
    const raw = buildRawMessage({
      to: "destino@example.com",
      subject: "Hola",
      body: "Cuerpo simple",
    });
    // base64url alphabet only
    assert.match(raw, /^[A-Za-z0-9_-]+$/);
    const decoded = decodeRaw(raw);
    assert.match(decoded, /^To: destino@example\.com\r\n/m);
    assert.match(decoded, /^Subject: Hola\r\n/m);
    assert.match(decoded, /^MIME-Version: 1\.0\r\n/m);
    assert.match(decoded, /^Content-Type: text\/plain; charset="UTF-8"\r\n/m);
    // body arrives intact after the blank line
    const body = decoded.split("\r\n\r\n").slice(1).join("\r\n\r\n");
    assert.equal(Buffer.from(body, "base64").toString("utf8"), "Cuerpo simple");
  });

  it("encodes non-ASCII subjects as RFC 2047 encoded-words and keeps accents in the body", () => {
    const raw = buildRawMessage({
      to: "a@example.com",
      subject: "Automatización con IA — año 2026",
      body: "Señora García:\ncláusula nº 42 ✓",
    });
    const decoded = decodeRaw(raw);
    const m = /^Subject: =\?UTF-8\?B\?(.+)\?=\r\n/m.exec(decoded);
    assert.ok(m, "subject must be an RFC 2047 UTF-8 encoded-word");
    assert.equal(Buffer.from(m![1], "base64").toString("utf8"), "Automatización con IA — año 2026");
    const body = decoded.split("\r\n\r\n").slice(1).join("\r\n\r\n");
    assert.equal(Buffer.from(body, "base64").toString("utf8"), "Señora García:\ncláusula nº 42 ✓");
  });

  it("includes Cc and Bcc only when provided", () => {
    const withCc = decodeRaw(
      buildRawMessage({ to: "a@x.com", subject: "s", body: "b", cc: "c@x.com", bcc: "d@x.com" }),
    );
    assert.match(withCc, /^Cc: c@x\.com\r\n/m);
    assert.match(withCc, /^Bcc: d@x\.com\r\n/m);
    const without = decodeRaw(buildRawMessage({ to: "a@x.com", subject: "s", body: "b" }));
    assert.doesNotMatch(without, /^Cc:/m);
    assert.doesNotMatch(without, /^Bcc:/m);
  });

  it("rejects header injection via CRLF in addresses or subject", () => {
    assert.throws(() => buildRawMessage({ to: "a@x.com\r\nBcc: evil@x.com", subject: "s", body: "b" }));
    assert.throws(() => buildRawMessage({ to: "a@x.com", subject: "s\r\nTo: evil@x.com", body: "b" }));
  });
});

describe("gmail_create_draft", () => {
  it("creates a draft for userId 'me' and returns the draft id — without ever sending", async () => {
    const { gmail, calls } = makeGmailMock();
    const { name, description, handler } = captureToolHandler(
      registerGmailCreateDraftTool as never,
      gmail,
    );
    assert.equal(name, "gmail_create_draft");
    assert.match(description, /never sends/i);

    const result = await handler({
      to: "cliente@example.com",
      subject: "Propuesta",
      body: "Hola,\n\nAdjunto la propuesta.\n",
    });

    assert.equal(calls.draftCreates.length, 1);
    assert.equal(calls.sendAttempts, 0);
    const params = calls.draftCreates[0] as {
      userId: string;
      requestBody: { message: { raw: string } };
    };
    assert.equal(params.userId, "me");
    const decoded = decodeRaw(params.requestBody.message.raw);
    assert.match(decoded, /^To: cliente@example\.com\r\n/m);
    assert.match(textOf(result), /draft-1/);
    assert.ok(!result.isError);
  });

  it("surfaces API errors as isError without retry-sending", async () => {
    const { gmail, calls } = makeGmailMock({ createError: makeApiError(500, "backend boom") });
    const { handler } = captureToolHandler(registerGmailCreateDraftTool as never, gmail);
    const result = await handler({ to: "a@x.com", subject: "s", body: "b" });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /backend boom/);
    assert.equal(calls.sendAttempts, 0);
  });

  it("gives an actionable hint on insufficient-scope 403 (token predates gmail.compose)", async () => {
    const { gmail } = makeGmailMock({
      createError: makeApiError(403, "Request had insufficient authentication scopes.", "insufficientPermissions"),
    });
    const { handler } = captureToolHandler(registerGmailCreateDraftTool as never, gmail);
    const result = await handler({ to: "a@x.com", subject: "s", body: "b" });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /re-run the auth flow/i);
    assert.match(textOf(result), /gmail/i);
  });
});
