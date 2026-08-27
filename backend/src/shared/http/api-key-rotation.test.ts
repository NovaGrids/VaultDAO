import assert from "node:assert/strict";
import test from "node:test";
import {
  ApiKeyRotationState,
  NoPendingRotationError,
} from "./api-key-rotation.js";

test("ApiKeyRotationState", async (t) => {
  await t.test("reports a pending rotation while a next key is staged", () => {
    const state = new ApiKeyRotationState("primary", "next");

    assert.equal(state.isRotationPending(), true);
    assert.equal(state.isOldKeyActive(), true);
    assert.deepEqual(state.snapshot(), {
      primaryKey: "primary",
      nextKey: "next",
    });
  });

  await t.test("reports no pending rotation when nothing is staged", () => {
    const state = new ApiKeyRotationState("primary");

    assert.equal(state.isRotationPending(), false);
    assert.equal(state.isOldKeyActive(), false);
    assert.equal(state.getLastRotatedAt(), undefined);
  });

  await t.test("promotes the next key and invalidates the old one", () => {
    const state = new ApiKeyRotationState("old-key", "new-key");

    const result = state.rotate();

    assert.equal(state.getPrimaryKey(), "new-key");
    assert.equal(state.getNextKey(), undefined);
    assert.equal(result.rotationPending, false);
    assert.equal(result.oldKeyActive, false);
    assert.ok(
      !Number.isNaN(Date.parse(result.rotatedAt)),
      "rotatedAt is an ISO timestamp",
    );
    assert.equal(state.getLastRotatedAt(), result.rotatedAt);
  });

  await t.test("leaves no snapshot in which the old key still resolves", () => {
    const state = new ApiKeyRotationState("old-key", "new-key");
    state.rotate();

    const snapshot = state.snapshot();
    assert.equal(snapshot.primaryKey, "new-key");
    assert.equal(snapshot.nextKey, undefined);
    assert.notEqual(snapshot.primaryKey, "old-key");
  });

  await t.test("refuses to rotate with no staged key", () => {
    const state = new ApiKeyRotationState("only-key");

    assert.throws(() => state.rotate(), NoPendingRotationError);
    // The primary key must survive a refused rotation untouched, otherwise a
    // failed call would lock every client out.
    assert.equal(state.getPrimaryKey(), "only-key");
  });

  await t.test("refuses a second rotation until a new key is staged", () => {
    const state = new ApiKeyRotationState("k1", "k2");
    state.rotate();

    assert.throws(() => state.rotate(), NoPendingRotationError);

    state.stageNextKey("k3");
    assert.equal(state.isRotationPending(), true);
    state.rotate();
    assert.equal(state.getPrimaryKey(), "k3");
  });
});
