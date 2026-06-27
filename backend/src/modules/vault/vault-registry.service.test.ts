import assert from "node:assert/strict";
import test from "node:test";
import { VaultRegistry } from "./vault-registry.service.js";

// Use a stub cursor factory to avoid filesystem writes
function stubCursorFactory() {
  return {
    getCursor: async () => null,
    saveCursor: async () => {},
  } as any;
}

function makeRegistry(addresses: string[] = []) {
  return new VaultRegistry(addresses, stubCursorFactory);
}

test("VaultRegistry: initializes with provided addresses", () => {
  const reg = makeRegistry(["CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"]);
  const list = reg.list();
  assert.equal(list.length, 1);
  assert.equal(list[0]!.address, "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
  assert.equal(list[0]!.status, "active");
});

test("VaultRegistry.addVault: adds a new vault", () => {
  const reg = makeRegistry();
  const result = reg.addVault("CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
  assert.equal(result.success, true);
  assert.equal(reg.list().length, 1);
});

test("VaultRegistry.addVault: rejects duplicate", () => {
  const reg = makeRegistry();
  reg.addVault("CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
  const result = reg.addVault("CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
  assert.equal(result.success, false);
  assert.ok(result.error?.includes("already registered"));
});

test("VaultRegistry.addVault: enforces max 20 vaults", () => {
  const reg = makeRegistry();
  // Fill up to 20
  for (let i = 0; i < 20; i++) {
    // Generate unique fake addresses (56 chars starting with C)
    const addr = `C${"A".repeat(54)}${i.toString(16).toUpperCase().padStart(1, "0")}`;
    reg.addVault(addr);
  }
  const result = reg.addVault("CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1");
  assert.equal(result.success, false);
  assert.ok(result.error?.includes("Maximum"));
});

test("VaultRegistry.removeVault: soft-removes a vault", () => {
  const reg = makeRegistry(["CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"]);
  const removed = reg.removeVault("CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
  assert.equal(removed, true);
  assert.equal(reg.get("CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF")?.status, "removed");
});

test("VaultRegistry.removeVault: returns false for unknown vault", () => {
  const reg = makeRegistry();
  assert.equal(reg.removeVault("CNONE"), false);
});

test("VaultRegistry: cursors are independent per vault", () => {
  const cursors = new Map<string, any>();
  const reg = new VaultRegistry(
    ["CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWHF"],
    (addr) => {
      const c = { addr, getCursor: async () => null, saveCursor: async () => {} } as any;
      cursors.set(addr, c);
      return c;
    },
  );
  const c1 = reg.getCursor("CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
  const c2 = reg.getCursor("CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWHF");
  assert.notEqual(c1, c2, "cursors should be independent instances");
});

test("VaultRegistry: cursor removed after vault removal", () => {
  const reg = makeRegistry(["CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"]);
  reg.removeVault("CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
  assert.equal(reg.getCursor("CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"), undefined);
});

test("VaultRegistry.getActiveAddresses: returns only active vaults", () => {
  const reg = makeRegistry([
    "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWHF",
  ]);
  reg.removeVault("CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
  const active = reg.getActiveAddresses();
  assert.equal(active.length, 1);
  assert.equal(active[0], "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWHF");
});

test("VaultRegistry.updateSyncLedger: updates lastSyncedLedger", () => {
  const reg = makeRegistry(["CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"]);
  reg.updateSyncLedger("CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", 12345);
  assert.equal(reg.get("CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF")?.lastSyncedLedger, 12345);
});
