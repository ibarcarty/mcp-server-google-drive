// Live smoke test against the real Google Drive API — validates the v1.2.0
// fixes end-to-end using the compiled dist/ (run `npm run build` first).
//
// Credentials: same resolution as the server itself (GDRIVE_MCP_OAUTH_PATH /
// GDRIVE_MCP_TOKEN_PATH env vars, or the default config directory).
//
// Every fixture is created under a throwaway folder and deleted at the end.
// Exit code 0 = all cases passed. Never prints tokens.
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { loadConfig } from "../dist/config.js";
import { createAuthenticatedClient } from "../dist/auth/credentials.js";
import { createDriveClient } from "../dist/drive/client.js";
import { registerReadFileTool } from "../dist/tools/read-file.js";
import { registerDeleteFileTool } from "../dist/tools/delete-file.js";
import { registerGetFileInfoTool } from "../dist/tools/file-info.js";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MARKER = "SMOKE-DOCX-MARKER live conversion content";

function captureHandler(register, ...clients) {
  let handler;
  const fakeServer = { tool: (_n, _d, _s, h) => { handler = h; } };
  register(fakeServer, ...clients);
  return handler;
}

const results = [];
function record(name, passed, detail = "") {
  results.push({ name, passed });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}
function textOf(res) {
  return (res?.content ?? []).map((c) => c.text).join("\n");
}

async function main() {
  const config = loadConfig();
  const auth = createAuthenticatedClient(config);
  const drive = createDriveClient(auth);

  const readTool = captureHandler(registerReadFileTool, drive);
  const deleteTool = captureHandler(registerDeleteFileTool, drive);
  const infoTool = captureHandler(registerGetFileInfoTool, drive);

  const stamp = new Date().toISOString().slice(0, 10);
  const cleanup = [];
  let folderId;

  try {
    // ---------- Fixtures ----------
    const folder = await drive.files.create({
      requestBody: { name: `_tmp-${stamp}-mcp-smoke-v120`, mimeType: "application/vnd.google-apps.folder" },
      fields: "id",
    });
    folderId = folder.data.id;

    // 1.5MB synthetic CSV
    let csv = "id,payload\n";
    while (csv.length < 1_500_000) {
      csv += `row-${String(csv.length).padStart(9, "0")},${"x".repeat(80)}\n`;
    }
    const csvFile = await drive.files.create({
      requestBody: { name: "big-fixture.csv", mimeType: "text/csv", parents: [folderId] },
      media: { mimeType: "text/csv", body: Readable.from([csv]) },
      fields: "id, size",
    });
    const csvId = csvFile.data.id;
    const csvSize = Number(csvFile.data.size);

    // Real .docx: temp Google Doc -> export -> upload -> remove temp
    const gdoc = await drive.files.create({
      requestBody: { name: "_tmp-gdoc-src", mimeType: "application/vnd.google-apps.document", parents: [folderId] },
      fields: "id",
    });
    const { google } = await import("googleapis");
    const docs = google.docs({ version: "v1", auth });
    await docs.documents.batchUpdate({
      documentId: gdoc.data.id,
      requestBody: { requests: [{ insertText: { location: { index: 1 }, text: `${MARKER}\nAcentos: informacion, senal.\n` } }] },
    });
    const docxExport = await drive.files.export(
      { fileId: gdoc.data.id, mimeType: DOCX_MIME },
      { responseType: "arraybuffer" },
    );
    const docxFile = await drive.files.create({
      requestBody: { name: "fixture.docx", mimeType: DOCX_MIME, parents: [folderId] },
      media: { mimeType: DOCX_MIME, body: Readable.from([Buffer.from(docxExport.data)]) },
      fields: "id",
    });
    const docxId = docxFile.data.id;
    await drive.files.delete({ fileId: gdoc.data.id });

    // Nested folder for file-info
    const child = await drive.files.create({
      requestBody: { name: "SMOKE-CHILD", mimeType: "application/vnd.google-apps.folder", parents: [folderId] },
      fields: "id",
    });
    const childId = child.data.id;

    // Shared-drive fixture: first shared drive that accepts a file in its root
    let sharedFixture = null;
    const drivesRes = await drive.drives.list({ pageSize: 50 });
    for (const sd of drivesRes.data.drives ?? []) {
      try {
        const f = await drive.files.create({
          requestBody: { name: `_tmp-${stamp}-smoke-delete.txt`, parents: [sd.id] },
          media: { mimeType: "text/plain", body: Readable.from(["smoke delete fixture\n"]) },
          fields: "id, driveId, capabilities(canDelete, canTrash)",
          supportsAllDrives: true,
        });
        sharedFixture = { fileId: f.data.id, driveName: sd.name, capabilities: f.data.capabilities };
        cleanup.push(f.data.id);
        break;
      } catch {
        // no create permission in this drive's root — try the next one
      }
    }

    // ---------- S1: ranged reads (defect 1) ----------
    const r1 = await readTool({ fileId: csvId });
    const t1 = textOf(r1);
    record(
      "S1a default read of a 1.5MB file is truncated with continuation hint",
      !r1.isError && /truncated/i.test(t1) && t1.includes("offset=200000") && t1.length < 260_000,
      `${t1.length} chars returned of ${csvSize} bytes`,
    );

    const r1b = await readTool({ fileId: csvId, offset: 200_000, maxBytes: 1_000 });
    const t1b = textOf(r1b);
    const expectedSlice = csv.slice(200_000, 201_000);
    record(
      "S1b offset/maxBytes returns the exact requested slice",
      !r1b.isError && t1b.includes(expectedSlice),
    );

    const tail = await readTool({ fileId: csvId, offset: csvSize - 500 });
    const tTail = textOf(tail);
    record(
      "S1c tail read reaches EOF without truncation notice",
      !tail.isError && !/truncated/i.test(tTail) && tTail.includes(csv.slice(-100)),
    );

    const CHUNK = 300_000;
    let reassembled = "";
    for (let off = 0; off < csvSize; off += CHUNK) {
      const part = await readTool({ fileId: csvId, offset: off, maxBytes: CHUNK });
      const body = textOf(part).split("\n---\n").slice(1).join("\n---\n");
      reassembled += body;
    }
    const hashLocal = createHash("sha256").update(csv).digest("hex");
    const hashRemote = createHash("sha256").update(reassembled).digest("hex");
    record("S1d chunked reassembly is byte-identical to the original", hashLocal === hashRemote,
      `sha256 ${hashRemote.slice(0, 12)}…`);

    // ---------- S3: Office conversion (defect 3) ----------
    const r3 = await readTool({ fileId: docxId });
    const t3 = textOf(r3);
    record(
      "S3a .docx converts to readable text (no U+FFFD, marker present)",
      !r3.isError && t3.includes(MARKER) && !t3.includes("�") && /Converted from Office/i.test(t3),
    );
    const leftovers = await drive.files.list({
      q: "name contains '[tmp-mcp-conversion]' and trashed = false",
      fields: "files(id)",
    });
    record("S3b temporary conversion copies are cleaned up", (leftovers.data.files ?? []).length === 0);

    // ---------- S4: file info (defect 4) ----------
    const r4 = await infoTool({ fileId: childId });
    const t4 = textOf(r4);
    record(
      "S4a folder info resolves name and parent name",
      !r4.isError && t4.includes("SMOKE-CHILD") && t4.includes(`_tmp-${stamp}-mcp-smoke-v120`) && t4.includes(folderId),
    );
    const r4b = await infoTool({ fileId: docxId });
    const t4b = textOf(r4b);
    record(
      "S4b file info shows size and mime for the .docx",
      !r4b.isError && /Size: \d+ bytes/.test(t4b) && t4b.includes(DOCX_MIME),
    );
    if (sharedFixture) {
      const r4c = await infoTool({ fileId: sharedFixture.fileId });
      const t4c = textOf(r4c);
      record(
        "S4c shared-drive item info names its shared drive",
        !r4c.isError && t4c.includes("Shared drive:"),
        sharedFixture.driveName,
      );
    } else {
      record("S4c shared-drive item info names its shared drive", false, "SKIP: no writable shared drive found");
    }

    // ---------- S2: delete (defect 2) ----------
    if (sharedFixture) {
      const caps = sharedFixture.capabilities ?? {};
      const r2 = await deleteTool({ fileId: sharedFixture.fileId });
      const t2 = textOf(r2);
      if (caps.canDelete === false) {
        const after = await drive.files.get({
          fileId: sharedFixture.fileId, fields: "trashed", supportsAllDrives: true,
        });
        record(
          "S2a shared-drive file without delete permission is trashed with a clear message",
          !r2.isError && /trash/i.test(t2) && /organizer/i.test(t2) && after.data.trashed === true,
          `capabilities=${JSON.stringify(caps)}`,
        );
      } else {
        let gone = false;
        try { await drive.files.get({ fileId: sharedFixture.fileId, fields: "id", supportsAllDrives: true }); }
        catch (e) { gone = e?.code === 404; }
        record(
          "S2a shared-drive file deleted permanently (caller is organizer here)",
          !r2.isError && gone,
          `capabilities=${JSON.stringify(caps)}`,
        );
      }
    } else {
      record("S2a shared-drive delete", false, "SKIP: no writable shared drive found");
    }

    const solo = await drive.files.create({
      requestBody: { name: "delete-me.txt", parents: [folderId] },
      media: { mimeType: "text/plain", body: Readable.from(["bye\n"]) },
      fields: "id",
    });
    const r2b = await deleteTool({ fileId: solo.data.id });
    let soloGone = false;
    try { await drive.files.get({ fileId: solo.data.id, fields: "id" }); }
    catch (e) { soloGone = e?.code === 404; }
    record(
      "S2b own file in My Drive is permanently deleted (regression)",
      !r2b.isError && /permanently deleted/i.test(textOf(r2b)) && soloGone,
    );
  } finally {
    // ---------- Teardown ----------
    if (folderId) {
      try {
        await drive.files.delete({ fileId: folderId, supportsAllDrives: true });
        console.log(`cleanup: smoke folder removed (${folderId})`);
      } catch (e) {
        console.log(`cleanup WARNING: could not remove smoke folder ${folderId}: ${e?.message}`);
      }
    }
    for (const id of cleanup) {
      try {
        await drive.files.update({ fileId: id, requestBody: { trashed: true }, supportsAllDrives: true });
      } catch {
        // already gone (deleted or trashed by the tests themselves)
      }
    }
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} smoke cases passed`);
  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error("SMOKE FAILED:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
