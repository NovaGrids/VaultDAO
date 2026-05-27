import assert from "node:assert/strict";
import { test, describe } from "node:test";
import * as fc from "fast-check";

import type { ContractEvent } from "../events.types.js";
import { EventNormalizer } from "./index.js";
import { EventType, CONTRACT_EVENT_MAP } from "../types.js";

describe("EventNormalizer Property-Based Tests", () => {
  // Save original console methods to prevent test log clutter from parsing errors
  const originalError = console.error;
  const originalWarn = console.warn;

  const silenceConsole = () => {
    console.error = () => {};
    console.warn = () => {};
  };

  const restoreConsole = () => {
    console.error = originalError;
    console.warn = originalWarn;
  };

  // Common metadata fields
  const idArb = fc.string({ minLength: 1 });
  const contractIdArb = fc.string({ minLength: 1 });
  const ledgerArb = fc.nat();
  const ledgerClosedAtArb = fc.integer({
    min: 946684800000, // 2000-01-01T00:00:00.000Z
    max: 1893456000000, // 2030-01-01T00:00:00.000Z
  }).map((t) => new Date(t).toISOString());

  // 1. Universal Event Arbitrary: Generates any structurally valid ContractEvent
  // with highly random, structural variations for the topic list and the value payload
  const universalEventArb: fc.Arbitrary<ContractEvent> = fc.record({
    id: idArb,
    contractId: contractIdArb,
    topic: fc.array(fc.string(), { minLength: 0, maxLength: 5 }),
    value: fc.anything(),
    ledger: ledgerArb,
    ledgerClosedAt: ledgerClosedAtArb,
  });

  const knownTopicsList = Object.keys(CONTRACT_EVENT_MAP);

  // Safe array value: satisfies array index parsing (e.g. d[0], d[7]) inside normalizers
  const safeArrayValueArb = fc.array(
    fc.string({ minLength: 1 }),
    { minLength: 10, maxLength: 15 }
  );

  // Safe object value: satisfies object-based parsing configurations for specific snapshot/admin normalizers
  const safeObjectValueArb = fc.record({
    admin: fc.string({ minLength: 1 }),
    address: fc.string({ minLength: 1 }),
    signer: fc.string({ minLength: 1 }),
    addr: fc.string({ minLength: 1 }),
    role: fc.nat(),
  });

  // 2. Known Topic Event Arbitrary: Generates a ContractEvent with a known/registered topic
  // and a value structured safely to bypass throwing inner-parsing exceptions
  const knownTopicEventArb: fc.Arbitrary<ContractEvent> = fc.record({
    id: idArb,
    contractId: contractIdArb,
    topic: fc.tuple(
      fc.constantFrom(...knownTopicsList),
      fc.string({ minLength: 1 })
    ),
    value: safeArrayValueArb,
    ledger: ledgerArb,
    ledgerClosedAt: ledgerClosedAtArb,
  });

  // 3. Unknown Topic Event Arbitrary: Generates an unrecognized/random topic
  // to test fallback behavior
  const unknownTopicEventArb: fc.Arbitrary<ContractEvent> = fc.record({
    id: idArb,
    contractId: contractIdArb,
    topic: fc.tuple(
      fc.string().filter((t) => !knownTopicsList.includes(t)),
      fc.string()
    ),
    value: fc.anything(),
    ledger: ledgerArb,
    ledgerClosedAt: ledgerClosedAtArb,
  });

  /**
   * PROPERTY 1: No-Throw Guarantee
   * Invariant: EventNormalizer.normalize(event) must never throw a runtime error
   * for any structurally valid ContractEvent generated (regardless of the inner value payload).
   */
  test("Property 1: No-Throw Guarantee", () => {
    silenceConsole();
    try {
      fc.assert(
        fc.property(universalEventArb, (event) => {
          assert.doesNotThrow(() => {
            EventNormalizer.normalize(event);
          });
        }),
        { numRuns: 100 }
      );
    } finally {
      restoreConsole();
    }
  });

  /**
   * PROPERTY 2: Schema Completeness
   * Invariant: The returned NormalizedEvent must always strictly contain the root-level fields:
   * type, data, and metadata, with fully populated and typed values.
   */
  test("Property 2: Schema Completeness", () => {
    silenceConsole();
    try {
      fc.assert(
        fc.property(universalEventArb, (event) => {
          const res = EventNormalizer.normalize(event);

          assert.ok(res, "NormalizedEvent must be defined");
          assert.strictEqual(typeof res, "object", "NormalizedEvent must be an object");
          assert.ok(res !== null, "NormalizedEvent must be non-null");

          // Root fields
          assert.ok("type" in res, "NormalizedEvent must contain 'type'");
          assert.ok("data" in res, "NormalizedEvent must contain 'data'");
          assert.ok("metadata" in res, "NormalizedEvent must contain 'metadata'");

          // Types & Enum
          assert.ok(
            Object.values(EventType).includes(res.type),
            "type must be a valid EventType enum value"
          );
          assert.strictEqual(typeof res.metadata, "object", "metadata must be an object");
          assert.ok(res.metadata !== null, "metadata must be non-null");

          // Metadata completeness
          assert.strictEqual(typeof res.metadata.id, "string", "metadata.id must be a string");
          assert.strictEqual(typeof res.metadata.contractId, "string", "metadata.contractId must be a string");
          assert.strictEqual(typeof res.metadata.ledger, "number", "metadata.ledger must be a number");
          assert.strictEqual(typeof res.metadata.ledgerClosedAt, "string", "metadata.ledgerClosedAt must be a string");

          // Metadata integrity mapping
          assert.strictEqual(res.metadata.contractId, event.contractId, "contractId must match the original event");
          assert.strictEqual(res.metadata.ledger, event.ledger, "ledger must match the original event");
          assert.strictEqual(res.metadata.ledgerClosedAt, event.ledgerClosedAt, "ledgerClosedAt must match the original event");
        }),
        { numRuns: 100 }
      );
    } finally {
      restoreConsole();
    }
  });

  /**
   * PROPERTY 3: Identity Integrity
   * Invariant: The nested path metadata.id must consistently resolve to the non-empty
   * ID string matching the original event's ID.
   */
  test("Property 3: Identity Integrity", () => {
    silenceConsole();
    try {
      fc.assert(
        fc.property(universalEventArb, (event) => {
          const res = EventNormalizer.normalize(event);

          assert.strictEqual(typeof res.metadata.id, "string", "metadata.id must be a string");
          assert.ok(res.metadata.id.length > 0, "metadata.id must be a non-empty string");
          assert.strictEqual(res.metadata.id, event.id, "metadata.id must perfectly match original event ID");
        }),
        { numRuns: 100 }
      );
    } finally {
      restoreConsole();
    }
  });

  /**
   * PROPERTY 4: Deterministic Classification (Known Topics)
   * Invariant: When the event includes a known/registered topic string, the resulting type
   * must not be classified as UNKNOWN, but instead map exactly to its registered EventType.
   */
  test("Property 4: Deterministic Classification (Known Topics)", () => {
    silenceConsole();
    try {
      fc.assert(
        fc.property(knownTopicEventArb, (event) => {
          const res = EventNormalizer.normalize(event);

          assert.notStrictEqual(res.type, EventType.UNKNOWN, `type should not be UNKNOWN for registered topic "${event.topic[0]}"`);
          assert.ok(Object.values(EventType).includes(res.type), "type must be a valid EventType");
        }),
        { numRuns: 100 }
      );
    } finally {
      restoreConsole();
    }
  });

  /**
   * PROPERTY 5: Fallback Classification (Unknown Topics)
   * Invariant: When the event contains completely random or unrecognized topic strings,
   * the resulting type must always evaluate to UNKNOWN.
   */
  test("Property 5: Fallback Classification (Unknown Topics)", () => {
    silenceConsole();
    try {
      fc.assert(
        fc.property(unknownTopicEventArb, (event) => {
          const res = EventNormalizer.normalize(event);

          assert.strictEqual(res.type, EventType.UNKNOWN, "type must always be evaluated as UNKNOWN");
          assert.strictEqual(res.data.reason, "Unmapped topic", "reason should fallback to 'Unmapped topic'");
          assert.deepEqual(res.data.rawTopic, event.topic, "rawTopic in data should match the original event topic list");
        }),
        { numRuns: 100 }
      );
    } finally {
      restoreConsole();
    }
  });
});
