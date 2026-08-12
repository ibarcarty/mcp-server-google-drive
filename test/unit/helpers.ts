// Shared test utilities: capture MCP tool handlers and build Drive API mocks.

export interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

interface CapturedTool {
  name: string;
  description: string;
  handler: ToolHandler;
}

/**
 * Runs a register*Tool function against a fake McpServer and returns the
 * captured handler so tests can invoke it directly.
 */
export function captureToolHandler(
  register: (server: never, ...clients: never[]) => void,
  ...clients: unknown[]
): CapturedTool {
  let captured: CapturedTool | undefined;
  const fakeServer = {
    tool(name: string, description: string, _schema: unknown, handler: ToolHandler) {
      captured = { name, description, handler };
    },
  };
  (register as (server: unknown, ...rest: unknown[]) => void)(fakeServer, ...clients);
  if (!captured) throw new Error("register function did not call server.tool()");
  return captured;
}

export function textOf(result: ToolResult): string {
  return result.content.map((c) => c.text).join("\n");
}

/** Builds an error shaped like the ones gaxios/googleapis throw. */
export function makeApiError(code: number, message: string, reason?: string): Error {
  return Object.assign(new Error(message), {
    code,
    errors: reason ? [{ reason, message }] : undefined,
  });
}

export function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/** Parses a Range header like "bytes=0-199999" into { start, end }. */
export function parseRangeHeader(range: string): { start: number; end: number } {
  const m = /^bytes=(\d+)-(\d+)$/.exec(range);
  if (!m) throw new Error(`unparseable Range header: ${range}`);
  return { start: Number(m[1]), end: Number(m[2]) };
}
