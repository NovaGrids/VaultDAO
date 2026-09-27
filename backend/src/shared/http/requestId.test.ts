import assert from "node:assert/strict";
import test from "node:test";

import {
  REQUEST_ID_PATTERN,
  generateRequestId,
  isValidRequestId,
  resolveRequestId,
} from "./requestId.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

test("generateRequestId returns a UUID that satisfies the allowed pattern", () => {
  const id = generateRequestId();
  assert.match(id, UUID_RE);
  assert.ok(REQUEST_ID_PATTERN.test(id));
});

test("resolveRequestId keeps well-formed client IDs", () => {
  for (const id of ["abc", "my-trace-id-123", "a.b_c-D.9", "x".repeat(64)]) {
    assert.equal(isValidRequestId(id), true, id);
    assert.equal(resolveRequestId(id), id);
  }
});

test("resolveRequestId generates a UUID when the header is missing", () => {
  assert.match(resolveRequestId(undefined), UUID_RE);
  assert.match(resolveRequestId(null), UUID_RE);
  assert.match(resolveRequestId(""), UUID_RE);
});

test("resolveRequestId rejects oversized values", () => {
  const long = "x".repeat(65);
  assert.equal(isValidRequestId(long), false);
  assert.match(resolveRequestId(long), UUID_RE);
});

test("resolveRequestId rejects control characters and log-injection payloads", () => {
  const malicious = [
    "abc\ndef",
    "abc\r\nINFO forged log line",
    "abc\u0000",
    "abc\u001b[31m",
    "has space",
    "quote\"id",
    "{\"json\":true}",
    "ünicode",
    "abc\n",
  ];
  for (const value of malicious) {
    assert.equal(isValidRequestId(value), false, JSON.stringify(value));
    const resolved = resolveRequestId(value);
    assert.notEqual(resolved, value);
    assert.match(resolved, UUID_RE);
  }
});
