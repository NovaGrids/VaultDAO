import assert from "node:assert/strict";
import test from "node:test";
import { ErrorsService } from "./errors.service.js";

test("ErrorsService.record: stores a new error and returns a fresh id", () => {
  const service = new ErrorsService();
  const { id, deduped } = service.record({ code: "REACT_ERROR_BOUNDARY", message: "boom" });

  assert.ok(id.length > 0);
  assert.strictEqual(deduped, false);
  assert.strictEqual(service.count(), 1);
});

test("ErrorsService.record: deduplicates repeated errors with the same code+message", () => {
  const service = new ErrorsService();
  const first = service.record({ code: "REACT_ERROR_BOUNDARY", message: "boom" });
  const second = service.record({ code: "REACT_ERROR_BOUNDARY", message: "boom" });

  assert.strictEqual(second.deduped, true);
  assert.strictEqual(second.id, first.id);
  assert.strictEqual(service.count(), 1);

  const [stored] = service.getRecent(1);
  assert.strictEqual(stored?.occurrences, 2);
});

test("ErrorsService.record: treats different messages as distinct errors", () => {
  const service = new ErrorsService();
  service.record({ code: "REACT_ERROR_BOUNDARY", message: "boom" });
  service.record({ code: "REACT_ERROR_BOUNDARY", message: "bang" });

  assert.strictEqual(service.count(), 2);
});

test("ErrorsService.getRecent: returns most recent errors first", () => {
  const service = new ErrorsService();
  service.record({ code: "A", message: "first" });
  service.record({ code: "B", message: "second" });

  const recent = service.getRecent(10);
  assert.strictEqual(recent[0]?.message, "second");
  assert.strictEqual(recent[1]?.message, "first");
});

test("ErrorsService.clear: empties the store", () => {
  const service = new ErrorsService();
  service.record({ code: "A", message: "first" });
  service.clear();

  assert.strictEqual(service.count(), 0);
});
