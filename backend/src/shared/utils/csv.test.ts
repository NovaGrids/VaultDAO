import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { csvLine, csvRecords, escapeCsvCell, writeCsvStream } from "./csv.js";

test("escapeCsvCell applies RFC 4180 quoting", () => {
  assert.equal(escapeCsvCell("a,b"), '"a,b"');
  assert.equal(escapeCsvCell('say "hi"'), '"say ""hi"""');
  assert.equal(escapeCsvCell("l1\nl2"), '"l1\nl2"');
  assert.equal(escapeCsvCell(null), "");
});

test("escapeCsvCell neutralizes formula payloads", () => {
  assert.equal(escapeCsvCell("=1+1"), "'=1+1");
  assert.equal(escapeCsvCell("+1"), "'+1");
  assert.equal(escapeCsvCell("-1"), "'-1");
  assert.equal(escapeCsvCell("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(escapeCsvCell('=HYPERLINK("http://x","y")'), `"'=HYPERLINK(""http://x"",""y"")"`);
  assert.equal(escapeCsvCell("a=b"), "a=b");
});

test("csvLine joins escaped cells", () => {
  assert.equal(csvLine(["x", "=y", 'q"']), `x,'=y,"q"""`);
});

test("large export streams lazily without materializing rows", async () => {
  const total = 200_000;
  let produced = 0;
  function* rows(): Generator<unknown[]> {
    for (let i = 0; i < total; i++) {
      produced++;
      yield [i, "=cmd", "x".repeat(20)];
    }
  }
  let written = 0;
  let maxAhead = 0;
  const sink = Object.assign(new EventEmitter(), {
    write(chunk: string) {
      written++;
      maxAhead = Math.max(maxAhead, produced - written);
      return written % 1000 !== 0; // simulate periodic backpressure
    },
  });
  setImmediate(function pump() {
    sink.emit("drain");
    if (written < total) setImmediate(pump);
  });
  await writeCsvStream(sink, csvRecords(rows(), "\n"));
  assert.equal(written, total);
  assert.ok(maxAhead <= 1, "generator must not run ahead of the sink");
});
