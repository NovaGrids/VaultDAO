import assert from "node:assert/strict";
import test from "node:test";

import {
  validateEventFilter,
  MAX_FILTER_ARRAY_SIZE,
  MAX_FILTER_STRING_LENGTH,
} from "./event-filter.validator.js";

function expectOk(result: ReturnType<typeof validateEventFilter>) {
  assert.equal(result.ok, true, `expected ok, got errors: ${JSON.stringify((result as any).errors)}`);
  return (result as any).filter;
}

function expectErrors(result: ReturnType<typeof validateEventFilter>) {
  assert.equal(result.ok, false, "expected validation to fail");
  return (result as any).errors as string[];
}

test("validateEventFilter — valid filters", async (t) => {
  await t.test("accepts a simple eventTypes filter", () => {
    const filter = expectOk(validateEventFilter({ eventTypes: ["PROPOSAL_CREATED"] }));
    assert.deepEqual(filter.eventTypes, ["PROPOSAL_CREATED"]);
  });

  await t.test("accepts legacy short topic names", () => {
    const filter = expectOk(validateEventFilter({ eventTypes: ["proposal_executed"] }));
    assert.deepEqual(filter.eventTypes, ["proposal_executed"]);
  });

  await t.test("accepts fully-namespaced topics with wildcards", () => {
    const filter = expectOk(
      validateEventFilter({ eventTypes: ["notification:events:*"] }),
    );
    assert.deepEqual(filter.eventTypes, ["notification:events:*"]);
  });

  await t.test("accepts contractIds instead of eventTypes", () => {
    const filter = expectOk(validateEventFilter({ contractIds: ["CDTEST123"] }));
    assert.deepEqual(filter.contractIds, ["CDTEST123"]);
  });

  await t.test("accepts a ledger range with minLedger <= maxLedger", () => {
    const filter = expectOk(
      validateEventFilter({ eventTypes: ["PROPOSAL_CREATED"], minLedger: 10, maxLedger: 20 }),
    );
    assert.equal(filter.minLedger, 10);
    assert.equal(filter.maxLedger, 20);
  });

  await t.test("accepts an array at exactly the max size", () => {
    const entries = Array.from({ length: MAX_FILTER_ARRAY_SIZE }, (_, i) => `TYPE_${i}`);
    const filter = expectOk(validateEventFilter({ eventTypes: entries }));
    assert.equal(filter.eventTypes.length, MAX_FILTER_ARRAY_SIZE);
  });

  await t.test("accepts a string at exactly the max length", () => {
    const entry = "A".repeat(MAX_FILTER_STRING_LENGTH);
    const filter = expectOk(validateEventFilter({ eventTypes: [entry] }));
    assert.equal(filter.eventTypes[0], entry);
  });
});

test("validateEventFilter — invalid filters", async (t) => {
  await t.test("rejects non-object input", () => {
    assert.equal(validateEventFilter(null).ok, false);
    assert.equal(validateEventFilter(undefined).ok, false);
    assert.equal(validateEventFilter("eventTypes").ok, false);
    assert.equal(validateEventFilter(42).ok, false);
    assert.equal(validateEventFilter(["PROPOSAL_CREATED"]).ok, false);
  });

  await t.test("rejects a filter with neither eventTypes nor contractIds", () => {
    const errors = expectErrors(validateEventFilter({ minLedger: 1 }));
    assert.ok(errors.some((e) => e.includes("at least one of eventTypes or contractIds")));
  });

  await t.test("rejects eventTypes that is not an array", () => {
    const errors = expectErrors(validateEventFilter({ eventTypes: "PROPOSAL_CREATED" }));
    assert.ok(errors.some((e) => e.includes("eventTypes must be an array")));
  });

  await t.test("rejects an empty eventTypes array", () => {
    const errors = expectErrors(validateEventFilter({ eventTypes: [] }));
    assert.ok(errors.some((e) => e.includes("must not be empty")));
  });

  await t.test("rejects arrays larger than the max size", () => {
    const entries = Array.from({ length: MAX_FILTER_ARRAY_SIZE + 1 }, (_, i) => `T${i}`);
    const errors = expectErrors(validateEventFilter({ eventTypes: entries }));
    assert.ok(errors.some((e) => e.includes(`at most ${MAX_FILTER_ARRAY_SIZE}`)));
  });

  await t.test("rejects non-string array entries instead of crashing", () => {
    const errors = expectErrors(
      validateEventFilter({ eventTypes: ["PROPOSAL_CREATED", 42, { evil: true }, null] }),
    );
    assert.ok(errors.some((e) => e.includes("eventTypes[1] must be a string")));
    assert.ok(errors.some((e) => e.includes("eventTypes[2] must be a string")));
    assert.ok(errors.some((e) => e.includes("eventTypes[3] must be a string")));
  });

  await t.test("rejects strings longer than the max length", () => {
    const errors = expectErrors(
      validateEventFilter({ eventTypes: ["A".repeat(MAX_FILTER_STRING_LENGTH + 1)] }),
    );
    assert.ok(errors.some((e) => e.includes(`between 1 and ${MAX_FILTER_STRING_LENGTH}`)));
  });

  await t.test("rejects SQL-like syntax", () => {
    const cases = [
      "PROPOSAL'; DROP TABLE events; --",
      "x' OR 1=1 --",
      "UNION SELECT * FROM users",
      "/* comment */ SELECT",
    ];
    for (const value of cases) {
      const errors = expectErrors(validateEventFilter({ eventTypes: [value] }));
      assert.ok(
        errors.some((e) => e.includes("SQL-like syntax") || e.includes("invalid characters")),
        `expected "${value}" to be rejected, got: ${JSON.stringify(errors)}`,
      );
    }
  });

  await t.test("rejects entries with disallowed characters", () => {
    const errors = expectErrors(validateEventFilter({ eventTypes: ["hello world!"] }));
    assert.ok(errors.some((e) => e.includes("invalid characters")));
  });

  await t.test("rejects a non-integer minLedger", () => {
    const errors = expectErrors(
      validateEventFilter({ eventTypes: ["PROPOSAL_CREATED"], minLedger: 1.5 }),
    );
    assert.ok(errors.some((e) => e.includes("minLedger must be an integer")));
  });

  await t.test("rejects a negative maxLedger", () => {
    const errors = expectErrors(
      validateEventFilter({ eventTypes: ["PROPOSAL_CREATED"], maxLedger: -1 }),
    );
    assert.ok(errors.some((e) => e.includes("maxLedger must be an integer") || e.includes("within [0")));
  });

  await t.test("rejects minLedger > maxLedger", () => {
    const errors = expectErrors(
      validateEventFilter({ eventTypes: ["PROPOSAL_CREATED"], minLedger: 100, maxLedger: 10 }),
    );
    assert.ok(errors.some((e) => e.includes("must be <=")));
  });

  await t.test("rejects unknown filter fields", () => {
    const errors = expectErrors(
      validateEventFilter({ eventTypes: ["PROPOSAL_CREATED"], $where: "1=1" }),
    );
    assert.ok(errors.some((e) => e.includes('unknown filter field: "$where"')));
  });

  await t.test("collects multiple errors at once", () => {
    const errors = expectErrors(
      validateEventFilter({
        eventTypes: [],
        minLedger: 100,
        maxLedger: 10,
        surprise: true,
      }),
    );
    assert.ok(errors.length >= 3);
  });
});
