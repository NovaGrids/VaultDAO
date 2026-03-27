import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryStorageAdapter } from "./storage.adapter.js";

// Test record type
interface TestRecord {
  id: string;
  name: string;
}

test("InMemoryStorageAdapter", async (t) => {
  // Create fresh adapter for each test
  const createAdapter = () => new InMemoryStorageAdapter<TestRecord>();

  await t.test(
    "getAll - returns all records when no filter provided",
    async () => {
      const adapter = createAdapter();
      const records: TestRecord[] = [
        { id: "1", name: "Alice" },
        { id: "2", name: "Bob" },
        { id: "3", name: "Charlie" },
      ];

      await adapter.saveMany(records);
      const all = await adapter.getAll();

      assert.strictEqual(all.length, 3, "Should return all 3 records");
      assert.deepStrictEqual(
        all.sort((a, b) => a.id.localeCompare(b.id)),
        records,
        "Should return all records with correct data",
      );
    },
  );

  await t.test("getAll - filters records by single property", async () => {
    const adapter = createAdapter();
    const records: TestRecord[] = [
      { id: "1", name: "Alice" },
      { id: "2", name: "Bob" },
      { id: "3", name: "Alice" },
    ];

    await adapter.saveMany(records);
    const filtered = await adapter.getAll({ name: "Alice" });

    assert.strictEqual(
      filtered.length,
      2,
      "Should return 2 records matching filter",
    );
    assert.ok(
      filtered.every((r) => r.name === "Alice"),
      "All returned records should match filter",
    );
  });

  await t.test("getAll - filters records by multiple properties", async () => {
    const adapter = createAdapter();
    const records: TestRecord[] = [
      { id: "1", name: "Alice" },
      { id: "2", name: "Bob" },
      { id: "3", name: "Alice" },
    ];

    await adapter.saveMany(records);
    const filtered = await adapter.getAll({ id: "1", name: "Alice" });

    assert.strictEqual(
      filtered.length,
      1,
      "Should return 1 record matching all filters",
    );
    assert.deepStrictEqual(
      filtered[0],
      { id: "1", name: "Alice" },
      "Should return correct filtered record",
    );
  });

  await t.test(
    "getAll - returns empty array when no records match filter",
    async () => {
      const adapter = createAdapter();
      const records: TestRecord[] = [
        { id: "1", name: "Alice" },
        { id: "2", name: "Bob" },
      ];

      await adapter.saveMany(records);
      const filtered = await adapter.getAll({ name: "Charlie" });

      assert.strictEqual(
        filtered.length,
        0,
        "Should return empty array for non-matching filter",
      );
    },
  );

  await t.test(
    "getAll - returns empty array when storage is empty",
    async () => {
      const adapter = createAdapter();
      const all = await adapter.getAll();

      assert.strictEqual(all.length, 0, "Should return empty array when empty");
    },
  );

  await t.test("saveMany - persists all provided records", async () => {
    const adapter = createAdapter();
    const records: TestRecord[] = [
      { id: "1", name: "Alice" },
      { id: "2", name: "Bob" },
      { id: "3", name: "Charlie" },
    ];

    await adapter.saveMany(records);
    const all = await adapter.getAll();

    assert.strictEqual(all.length, 3, "All records should be persisted");
    assert.ok(
      records.every((r) => all.some((a) => a.id === r.id && a.name === r.name)),
      "All saved records should be retrievable",
    );
  });

  await t.test(
    "saveMany - overwrites existing records with same ID",
    async () => {
      const adapter = createAdapter();
      const initial: TestRecord[] = [{ id: "1", name: "Alice" }];
      const updated: TestRecord[] = [{ id: "1", name: "Alice Updated" }];

      await adapter.saveMany(initial);
      await adapter.saveMany(updated);

      const record = await adapter.getById("1");
      assert.deepStrictEqual(
        record,
        { id: "1", name: "Alice Updated" },
        "Record should be overwritten",
      );
    },
  );

  await t.test("saveMany - handles empty array", async () => {
    const adapter = createAdapter();
    await adapter.saveMany([]);

    const all = await adapter.getAll();
    assert.strictEqual(all.length, 0, "Should handle empty array gracefully");
  });

  await t.test("exists - returns true when record exists", async () => {
    const adapter = createAdapter();
    await adapter.save({ id: "1", name: "Alice" });

    const exists = await adapter.exists("1");
    assert.strictEqual(exists, true, "Should return true for existing record");
  });

  await t.test(
    "exists - returns false when record does not exist",
    async () => {
      const adapter = createAdapter();
      const exists = await adapter.exists("non-existent");

      assert.strictEqual(
        exists,
        false,
        "Should return false for non-existent record",
      );
    },
  );

  await t.test("count - returns total count without filter", async () => {
    const adapter = createAdapter();
    const records: TestRecord[] = [
      { id: "1", name: "Alice" },
      { id: "2", name: "Bob" },
      { id: "3", name: "Charlie" },
    ];

    await adapter.saveMany(records);
    const count = await adapter.count();

    assert.strictEqual(count, 3, "Should return correct total count");
  });

  await t.test("count - returns 0 for empty storage", async () => {
    const adapter = createAdapter();
    const count = await adapter.count();

    assert.strictEqual(count, 0, "Should return 0 for empty storage");
  });

  await t.test(
    "count - returns filtered count with single filter property",
    async () => {
      const adapter = createAdapter();
      const records: TestRecord[] = [
        { id: "1", name: "Alice" },
        { id: "2", name: "Bob" },
        { id: "3", name: "Alice" },
      ];

      await adapter.saveMany(records);
      const count = await adapter.count({ name: "Alice" });

      assert.strictEqual(count, 2, "Should return correct filtered count");
    },
  );

  await t.test(
    "count - returns filtered count with multiple filter properties",
    async () => {
      const adapter = createAdapter();
      const records: TestRecord[] = [
        { id: "1", name: "Alice" },
        { id: "2", name: "Bob" },
        { id: "3", name: "Alice" },
      ];

      await adapter.saveMany(records);
      const count = await adapter.count({ id: "1", name: "Alice" });

      assert.strictEqual(
        count,
        1,
        "Should return correct count for multiple filters",
      );
    },
  );

  await t.test("count - returns 0 when no records match filter", async () => {
    const adapter = createAdapter();
    const records: TestRecord[] = [
      { id: "1", name: "Alice" },
      { id: "2", name: "Bob" },
    ];

    await adapter.saveMany(records);
    const count = await adapter.count({ name: "Charlie" });

    assert.strictEqual(count, 0, "Should return 0 when no records match");
  });

  await t.test("count - matches getAll length with same filter", async () => {
    const adapter = createAdapter();
    const records: TestRecord[] = [
      { id: "1", name: "Alice" },
      { id: "2", name: "Bob" },
      { id: "3", name: "Alice" },
      { id: "4", name: "Charlie" },
      { id: "5", name: "Alice" },
    ];

    await adapter.saveMany(records);
    const filter = { name: "Alice" };
    const count = await adapter.count(filter);
    const all = await adapter.getAll(filter);

    assert.strictEqual(
      count,
      all.length,
      "count should match getAll length with same filter",
    );
  });

  await t.test("clear - removes all records", async () => {
    const adapter = createAdapter();
    const records: TestRecord[] = [
      { id: "1", name: "Alice" },
      { id: "2", name: "Bob" },
    ];

    await adapter.saveMany(records);
    await adapter.clear();

    const all = await adapter.getAll();
    assert.strictEqual(all.length, 0, "All records should be cleared");
  });

  await t.test("clear - can be called on empty storage", async () => {
    const adapter = createAdapter();
    await adapter.clear();

    const all = await adapter.getAll();
    assert.strictEqual(all.length, 0, "Should handle clearing empty storage");
  });

  await t.test("save - persists single record", async () => {
    const adapter = createAdapter();
    const record: TestRecord = { id: "1", name: "Alice" };

    await adapter.save(record);
    const retrieved = await adapter.getById("1");

    assert.deepStrictEqual(retrieved, record, "Record should be persisted");
  });

  await t.test("save - overwrites existing record", async () => {
    const adapter = createAdapter();
    await adapter.save({ id: "1", name: "Alice" });
    await adapter.save({ id: "1", name: "Alice Updated" });

    const retrieved = await adapter.getById("1");
    assert.deepStrictEqual(
      retrieved,
      { id: "1", name: "Alice Updated" },
      "Record should be overwritten",
    );
  });

  await t.test("getById - returns null for non-existent record", async () => {
    const adapter = createAdapter();
    const record = await adapter.getById("non-existent");

    assert.strictEqual(
      record,
      null,
      "Should return null for non-existent record",
    );
  });

  await t.test("delete - removes record by ID", async () => {
    const adapter = createAdapter();
    await adapter.save({ id: "1", name: "Alice" });
    await adapter.delete("1");

    const record = await adapter.getById("1");
    assert.strictEqual(record, null, "Record should be deleted");
  });

  await t.test("delete - handles deletion of non-existent record", async () => {
    const adapter = createAdapter();
    await adapter.delete("non-existent");

    const all = await adapter.getAll();
    assert.strictEqual(
      all.length,
      0,
      "Should handle deleting non-existent record",
    );
  });

  await t.test("integration - complex workflow", async () => {
    const adapter = createAdapter();

    // Add initial records
    await adapter.saveMany([
      { id: "1", name: "Alice" },
      { id: "2", name: "Bob" },
      { id: "3", name: "Charlie" },
    ]);

    // Verify count
    let count = await adapter.count();
    assert.strictEqual(count, 3, "Should have 3 records");

    // Filter and check count matches getAll
    const filter = { name: "Alice" };
    const filteredCount = await adapter.count(filter);
    const filtered = await adapter.getAll(filter);
    assert.strictEqual(
      filteredCount,
      filtered.length,
      "Count should match filtered length",
    );

    // Update a record
    await adapter.save({ id: "1", name: "Alice Updated" });
    const updated = await adapter.getById("1");
    assert.strictEqual(updated?.name, "Alice Updated", "Should update record");

    // Delete and verify
    await adapter.delete("2");
    const exists = await adapter.exists("2");
    assert.strictEqual(exists, false, "Record should be deleted");

    // Final count
    count = await adapter.count();
    assert.strictEqual(count, 2, "Should have 2 records after deletion");

    // Clear all
    await adapter.clear();
    count = await adapter.count();
    assert.strictEqual(count, 0, "Should be empty after clear");
  });
});
