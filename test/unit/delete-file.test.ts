// Contract tests for drive_delete_file:
//  - Defect 2 (found 2026-08-11): "File not found" on shared-drive files that exist. Root cause
//    (verified live 2026-08-12): the Drive API answers 404 to files.delete when the
//    caller lacks permanent-delete permission (non-organizer in a shared drive) —
//    with or without supportsAllDrives. The tool must check capabilities and fall
//    back to trash, and must explain the ambiguous 404 when it happens.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { registerDeleteFileTool } from "../../src/tools/delete-file.js";
import { captureToolHandler, textOf, makeApiError } from "./helpers.js";

interface DeleteMockCalls {
  gets: Array<Record<string, unknown>>;
  deletes: Array<Record<string, unknown>>;
  updates: Array<Record<string, unknown>>;
}

function makeDriveMock(opts: {
  capabilities?: { canDelete?: boolean; canTrash?: boolean };
  deleteError?: Error;
  driveId?: string;
}) {
  const calls: DeleteMockCalls = { gets: [], deletes: [], updates: [] };
  const drive = {
    files: {
      async get(params: Record<string, unknown>) {
        calls.gets.push(params);
        return {
          data: {
            id: params.fileId,
            name: "victim.txt",
            mimeType: "text/plain",
            driveId: opts.driveId,
            capabilities: opts.capabilities,
          },
        };
      },
      async delete(params: Record<string, unknown>) {
        calls.deletes.push(params);
        if (opts.deleteError) throw opts.deleteError;
        return { data: undefined };
      },
      async update(params: Record<string, unknown>) {
        calls.updates.push(params);
        return { data: { id: params.fileId, trashed: true } };
      },
    },
  };
  return { drive, calls };
}

function handlerFor(drive: unknown) {
  return captureToolHandler(
    registerDeleteFileTool as (server: never, ...clients: never[]) => void,
    drive,
  ).handler;
}

describe("drive_delete_file — shared drives (defect 2)", () => {
  it("falls back to trash when permanent deletion is not permitted", async () => {
    const { drive, calls } = makeDriveMock({
      capabilities: { canDelete: false, canTrash: true },
      driveId: "sd-001",
    });
    const result = await handlerFor(drive)({ fileId: "shared-file-1" });
    const text = textOf(result);

    assert.ok(!result.isError, text);
    assert.equal(calls.deletes.length, 0, "must not attempt a permanent delete that will 404");
    assert.equal(calls.updates.length, 1, "must move to trash instead");
    const update = calls.updates[0];
    assert.equal((update.requestBody as Record<string, unknown>).trashed, true);
    assert.equal(update.supportsAllDrives, true);
    assert.match(text, /trash/i, "message must say the file went to the trash");
    assert.match(text, /organizer/i, "message must explain why permanent deletion was not possible");
  });

  it("reports clearly when the file can be neither deleted nor trashed", async () => {
    const { drive, calls } = makeDriveMock({
      capabilities: { canDelete: false, canTrash: false },
      driveId: "sd-001",
    });
    const result = await handlerFor(drive)({ fileId: "shared-file-2" });
    const text = textOf(result);

    assert.equal(result.isError, true);
    assert.equal(calls.deletes.length, 0);
    assert.equal(calls.updates.length, 0);
    assert.match(text, /permission/i);
  });

  it("explains the ambiguous 404 (not found OR no permission) when a delete still fails", async () => {
    const { drive } = makeDriveMock({
      capabilities: { canDelete: true, canTrash: true },
      deleteError: makeApiError(404, "File not found: shared-file-3.", "notFound"),
    });
    const result = await handlerFor(drive)({ fileId: "shared-file-3" });
    const text = textOf(result);

    assert.equal(result.isError, true);
    assert.match(text, /not found/i);
    assert.match(text, /permission/i, "must mention that Drive returns 404 for missing permissions too");
  });
});

describe("drive_delete_file — regressions", () => {
  it("permanently deletes a regular file when allowed", async () => {
    const { drive, calls } = makeDriveMock({
      capabilities: { canDelete: true, canTrash: true },
    });
    const result = await handlerFor(drive)({ fileId: "own-file-1" });
    const text = textOf(result);

    assert.ok(!result.isError, text);
    assert.equal(calls.deletes.length, 1);
    assert.equal(calls.deletes[0].supportsAllDrives, true);
    assert.equal(calls.updates.length, 0);
    assert.match(text, /permanently deleted/i);
  });

  it("attempts the delete when capabilities are absent (older mocks/edge cases)", async () => {
    const { drive, calls } = makeDriveMock({ capabilities: undefined });
    const result = await handlerFor(drive)({ fileId: "own-file-2" });

    assert.ok(!result.isError, textOf(result));
    assert.equal(calls.deletes.length, 1);
  });
});
