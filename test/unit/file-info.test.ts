// Contract tests for drive_get_file_info (defect 4, found 2026-08-11):
// there was no way to get the name/parent of an item from its ID — only to list
// its children. The new tool must return extended metadata with parents resolved
// to names, and the shared-drive name when applicable.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { registerGetFileInfoTool } from "../../src/tools/file-info.js";
import { captureToolHandler, textOf } from "./helpers.js";

interface InfoMockCalls {
  fileGets: Array<Record<string, unknown>>;
  driveGets: Array<Record<string, unknown>>;
}

function makeDriveMock(opts: {
  target: Record<string, unknown>;
  parents?: Record<string, { name: string }>;
  driveName?: string;
}) {
  const calls: InfoMockCalls = { fileGets: [], driveGets: [] };
  const drive = {
    files: {
      async get(params: Record<string, unknown>) {
        calls.fileGets.push(params);
        const id = params.fileId as string;
        if (opts.parents && opts.parents[id]) {
          return { data: { id, name: opts.parents[id].name } };
        }
        return { data: { id, ...opts.target } };
      },
    },
    drives: {
      async get(params: Record<string, unknown>) {
        calls.driveGets.push(params);
        if (!opts.driveName) throw new Error("no drive");
        return { data: { id: params.driveId, name: opts.driveName } };
      },
    },
  };
  return { drive, calls };
}

function handlerFor(drive: unknown) {
  return captureToolHandler(
    registerGetFileInfoTool as (server: never, ...clients: never[]) => void,
    drive,
  ).handler;
}

describe("drive_get_file_info (defect 4)", () => {
  it("returns extended metadata with the parent folder resolved to its name", async () => {
    const { drive } = makeDriveMock({
      target: {
        name: "Subcarpeta B",
        mimeType: "application/vnd.google-apps.folder",
        parents: ["parent-A"],
        webViewLink: "https://drive.google.com/x",
        createdTime: "2026-08-12T10:00:00Z",
        modifiedTime: "2026-08-12T11:00:00Z",
        capabilities: { canEdit: true, canDelete: true, canTrash: true },
      },
      parents: { "parent-A": { name: "Carpeta A" } },
    });
    const result = await handlerFor(drive)({ fileId: "folder-B" });
    const text = textOf(result);

    assert.ok(!result.isError, text);
    assert.match(text, /Subcarpeta B/);
    assert.match(text, /Carpeta A/, "parent must be resolved to its name");
    assert.match(text, /parent-A/, "parent ID must also be present");
    assert.match(text, /folder/i);
  });

  it("handles items without parents (root level) without failing", async () => {
    const { drive, calls } = makeDriveMock({
      target: { name: "solo.txt", mimeType: "text/plain", size: "10" },
    });
    const result = await handlerFor(drive)({ fileId: "solo-1" });
    const text = textOf(result);

    assert.ok(!result.isError, text);
    assert.match(text, /solo\.txt/);
    assert.equal(calls.fileGets.length, 1, "no parent lookups when there are no parents");
    assert.equal(calls.driveGets.length, 0, "no shared-drive lookup without driveId");
  });

  it("resolves the shared-drive name when the item lives in one", async () => {
    const { drive, calls } = makeDriveMock({
      target: {
        name: "shared-item.txt",
        mimeType: "text/plain",
        size: "42",
        driveId: "sd-777",
        parents: ["sd-777"],
      },
      parents: { "sd-777": { name: "ignored-by-drive-lookup" } },
      driveName: "Team Shared Drive",
    });
    const result = await handlerFor(drive)({ fileId: "shared-item-1" });
    const text = textOf(result);

    assert.ok(!result.isError, text);
    assert.equal(calls.driveGets.length, 1);
    assert.match(text, /Team Shared Drive/, "shared drive resolved to its name");
    assert.match(text, /shared-item\.txt/);
    assert.match(text, /42/, "size present");
  });
});
