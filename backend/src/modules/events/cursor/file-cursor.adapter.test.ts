import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";

import { FileCursorAdapter } from "./file-cursor.adapter.js";
import type { EventCursor } from "./cursor.types.js";

const tempDir = path.join(process.cwd(), "tmp-cursor-test");

test.before(() => {
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
});

test.after(() => {
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("FileCursorAdapter returns null when file missing", async () => {
  const adapter = new FileCursorAdapter(tempDir);
  const cursor = await adapter.getCursor();
  assert.equal(cursor, null);
});

test("FileCursorAdapter handles corrupt JSON gracefully", async () => {
  const filePath = path.join(tempDir, ".event-cursor.json");
  fs.writeFileSync(filePath, "{ invalid json", "utf8");

  const adapter = new FileCursorAdapter(tempDir);
  const cursor = await adapter.getCursor();

  assert.equal(cursor, null);

  const backupFiles = fs.readdirSync(tempDir).filter((f) => f.startsWith(".event-cursor.json.corrupt."));
  assert(backupFiles.length > 0, "corrupt file backup should be created");
});

test("FileCursorAdapter saves and loads cursor successfully", async () => {
  const adapter = new FileCursorAdapter(tempDir);
  const expected: EventCursor = { lastEventId: "abc", lastLedger: 123, updatedAt: new Date().toISOString() };

  await adapter.saveCursor(expected);
  const result = await adapter.getCursor();

  assert.deepEqual(result, expected);
});

test("FileCursorAdapter saveCursor uses atomic replacement without leftover temp files", async () => {
  const adapter = new FileCursorAdapter(tempDir);

  await adapter.saveCursor({
    lastEventId: "atomic-1",
    lastLedger: 1,
    updatedAt: new Date().toISOString(),
  });

  await adapter.saveCursor({
    lastEventId: "atomic-2",
    lastLedger: 2,
    updatedAt: new Date().toISOString(),
  });

  const files = fs.readdirSync(tempDir);
  const tempFiles = files.filter((name) => name.includes(".event-cursor.json.tmp-"));

  assert.equal(tempFiles.length, 0, "temporary files should be cleaned up after atomic rename");
  assert.equal(files.includes(".event-cursor.json"), true, "final cursor file should exist");
});
