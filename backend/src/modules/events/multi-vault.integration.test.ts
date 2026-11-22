import test from "node:test";
import assert from "node:assert/strict";
import { EventPollingService } from "./events.service.js";
import type { CursorStorage, EventCursor } from "./cursor/cursor.types.js";
import type { BackendEnv } from "../../config/env.js";

function createInMemoryMultiVaultStorage(): CursorStorage & {
  cursors: Map<string, EventCursor>;
} {
  const cursors = new Map<string, EventCursor>();
  return {
    cursors,
    async getCursor() {
      return cursors.get("default") ?? null;
    },
    async getCursorForContract(contractId: string) {
      return cursors.get(contractId) ?? null;
    },
    async saveCursor(cursor: EventCursor) {
      cursors.set("default", cursor);
    },
    async saveCursorForContract(contractId: string, cursor: EventCursor) {
      cursors.set(contractId, cursor);
    },
    async listCursors() {
      return Array.from(cursors.entries()).map(([id, cursor]) => ({
        id,
        cursor,
      }));
    },
    async deleteCursor(id: string) {
      cursors.delete(id);
    },
  };
}

test("multi-vault indexer: two mocked contracts advance independently, isolate outages, and fail closed", async () => {
  const storage = createInMemoryMultiVaultStorage();
  await storage.saveCursorForContract!("VAULT_A", {
    lastLedger: 100,
    updatedAt: new Date().toISOString(),
  });
  await storage.saveCursorForContract!("VAULT_B", {
    lastLedger: 200,
    updatedAt: new Date().toISOString(),
  });

  let failVaultB = false;
  const mockRpcClient = {
    async getLatestLedger() {
      return 250;
    },
    async getEventsPage(params: {
      startLedger: number;
      filters: Array<{ contractIds: string[] }>;
    }) {
      const contractId = params.filters[0].contractIds[0];
      if (contractId === "VAULT_B" && failVaultB) {
        throw new Error("RPC timeout for VAULT_B");
      }
      const latestLedger = contractId === "VAULT_A" ? 110 : 215;
      return {
        latestLedger,
        events: [
          {
            id: `${contractId}-evt-1`,
            contractId,
            topic: ["proposal_created"],
            value: {},
            ledger: latestLedger,
            ledgerClosedAt: new Date().toISOString(),
            pagingToken: "tok-1",
          },
        ],
      };
    },
  } as any;

  const env = {
    contractId: "VAULT_A",
    contractIds: ["VAULT_A", "VAULT_B"],
    indexingParallelism: 2,
    sorobanRpcUrl: "https://mock-rpc.local",
    normalizerCacheMaxSize: 100,
  } as BackendEnv;

  const service = new EventPollingService(
    env,
    storage,
    undefined,
    undefined,
    undefined,
    mockRpcClient,
  );

  // 1. Both vaults advance independently
  await service.pollAllContracts();
  assert.equal((await storage.getCursorForContract!("VAULT_A"))?.lastLedger, 110);
  assert.equal((await storage.getCursorForContract!("VAULT_B"))?.lastLedger, 215);

  // 2. VAULT_B RPC outage does not stall VAULT_A, and VAULT_B fails closed (cursor stays 215)
  failVaultB = true;
  await service.pollAllContracts();

  const states = service.getPerVaultStates();
  assert.equal(states["VAULT_A"].lastLedger, 110);
  assert.equal(states["VAULT_A"].consecutiveErrors, 0);
  assert.equal(states["VAULT_B"].consecutiveErrors, 1);
  assert.equal(states["VAULT_B"].lastErrorClass, "timeout");
  assert.equal((await storage.getCursorForContract!("VAULT_B"))?.lastLedger, 215);
});
