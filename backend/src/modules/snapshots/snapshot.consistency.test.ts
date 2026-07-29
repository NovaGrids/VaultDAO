/**
 * Snapshot Consistency Verification Tests
 *
 * Tests for `SnapshotService.verifySnapshotConsistency`, which reconciles the
 * event-built snapshot against current on-chain state and emits an event per
 * verification.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { SnapshotService } from "./snapshot.service.js";
import { MemorySnapshotAdapter } from "./adapters/memory.adapter.js";
import type { NormalizedEvent } from "../events/types.js";
import { EventType } from "../events/types.js";
import { Role } from "./types.js";
import type {
  SignerAddedData,
  SignerRemovedData,
  OnChainConfigProvider,
  SnapshotVerificationEmitter,
  SnapshotVerificationEvent,
} from "./types.js";

const CONTRACT_ID = "CDUMMYCONTRACT123456789";
const SIGNER_A = "GSIGNERA123456789";
const SIGNER_B = "GSIGNERB123456789";
const SIGNER_C = "GSIGNERC123456789";

/** Stub on-chain provider returning a fixed signer set. */
function stubProvider(
  signers: string[],
  threshold = 2,
): OnChainConfigProvider {
  return {
    async getVaultConfig() {
      return { signers, threshold };
    },
  };
}

/** Recording emitter that captures every delivered event. */
function recordingEmitter(): SnapshotVerificationEmitter & {
  events: SnapshotVerificationEvent[];
} {
  const events: SnapshotVerificationEvent[] = [];
  return {
    events,
    async deliver(event) {
      events.push(event);
    },
  };
}

/** Seed a snapshot with a set of active signers via SIGNER_ADDED events. */
async function seedSigners(
  service: SnapshotService,
  addresses: string[],
): Promise<void> {
  let ledger = 100;
  for (const address of addresses) {
    const event: NormalizedEvent<SignerAddedData> = {
      type: EventType.SIGNER_ADDED,
      data: { address, role: Role.TREASURER, ledger, timestamp: "2026-03-25T12:00:00Z" },
      metadata: {
        id: `add-${address}`,
        contractId: CONTRACT_ID,
        ledger,
        ledgerClosedAt: "2026-03-25T12:00:00Z",
      },
    };
    await service.processEvent(event);
    ledger += 1;
  }
}

test("verifySnapshotConsistency - reports consistent when signer sets match", async () => {
  const adapter = new MemorySnapshotAdapter();
  const emitter = recordingEmitter();
  const service = new SnapshotService(adapter, undefined, {
    onChainProvider: stubProvider([SIGNER_A, SIGNER_B]),
    verificationEmitter: emitter,
  });

  await seedSigners(service, [SIGNER_A, SIGNER_B]);

  const result = await service.verifySnapshotConsistency(CONTRACT_ID);

  assert.equal(result.consistent, true);
  assert.equal(result.mismatches.length, 0);
  assert.deepEqual(result.onChainSigners, [SIGNER_A, SIGNER_B].sort());
  assert.deepEqual(result.snapshotSigners, [SIGNER_A, SIGNER_B].sort());

  // One "verified" event emitted.
  assert.equal(emitter.events.length, 1);
  assert.equal(emitter.events[0]!.topic, "snapshot:consistency-verified");
  assert.equal(emitter.events[0]!.payload.consistent, true);
});

test("verifySnapshotConsistency - order-independent signer comparison", async () => {
  const adapter = new MemorySnapshotAdapter();
  const service = new SnapshotService(adapter, undefined, {
    // On-chain returns signers in a different order than they were added.
    onChainProvider: stubProvider([SIGNER_B, SIGNER_A]),
  });

  await seedSigners(service, [SIGNER_A, SIGNER_B]);

  const result = await service.verifySnapshotConsistency(CONTRACT_ID);
  assert.equal(result.consistent, true);
});

test("verifySnapshotConsistency - detects signer present on-chain but missing from snapshot", async () => {
  const adapter = new MemorySnapshotAdapter();
  const emitter = recordingEmitter();
  const service = new SnapshotService(adapter, undefined, {
    onChainProvider: stubProvider([SIGNER_A, SIGNER_B, SIGNER_C]),
    verificationEmitter: emitter,
  });

  // Snapshot only knows about A and B — event for C was missed.
  await seedSigners(service, [SIGNER_A, SIGNER_B]);

  const result = await service.verifySnapshotConsistency(CONTRACT_ID);

  assert.equal(result.consistent, false);
  assert.equal(result.mismatches.length, 1);
  assert.equal(result.mismatches[0]!.field, "signers");
  assert.equal(result.mismatches[0]!.onChain, SIGNER_C);
  assert.equal(result.mismatches[0]!.snapshot, null);

  assert.equal(emitter.events.length, 1);
  assert.equal(emitter.events[0]!.topic, "snapshot:consistency-drift");
  assert.equal(emitter.events[0]!.payload.consistent, false);
});

test("verifySnapshotConsistency - detects signer active in snapshot but absent on-chain", async () => {
  const adapter = new MemorySnapshotAdapter();
  const service = new SnapshotService(adapter, undefined, {
    // On-chain has removed SIGNER_B; snapshot never processed the removal.
    onChainProvider: stubProvider([SIGNER_A]),
  });

  await seedSigners(service, [SIGNER_A, SIGNER_B]);

  const result = await service.verifySnapshotConsistency(CONTRACT_ID);

  assert.equal(result.consistent, false);
  assert.equal(result.mismatches.length, 1);
  assert.equal(result.mismatches[0]!.snapshot, SIGNER_B);
  assert.equal(result.mismatches[0]!.onChain, null);
});

test("verifySnapshotConsistency - removed signers are excluded from comparison", async () => {
  const adapter = new MemorySnapshotAdapter();
  const service = new SnapshotService(adapter, undefined, {
    onChainProvider: stubProvider([SIGNER_A]),
  });

  await seedSigners(service, [SIGNER_A, SIGNER_B]);

  // Remove SIGNER_B from the snapshot — it should now match on-chain (A only).
  const removeEvent: NormalizedEvent<SignerRemovedData> = {
    type: EventType.SIGNER_REMOVED,
    data: { signer: SIGNER_B },
    metadata: {
      id: "remove-b",
      contractId: CONTRACT_ID,
      ledger: 200,
      ledgerClosedAt: "2026-03-26T12:00:00Z",
    },
  };
  await service.processEvent(removeEvent);

  const result = await service.verifySnapshotConsistency(CONTRACT_ID);
  assert.equal(result.consistent, true, JSON.stringify(result.mismatches));
});

test("verifySnapshotConsistency - reports both directions of drift at once", async () => {
  const adapter = new MemorySnapshotAdapter();
  const service = new SnapshotService(adapter, undefined, {
    // On-chain: A and C. Snapshot: A and B. B is extra, C is missing.
    onChainProvider: stubProvider([SIGNER_A, SIGNER_C]),
  });

  await seedSigners(service, [SIGNER_A, SIGNER_B]);

  const result = await service.verifySnapshotConsistency(CONTRACT_ID);

  assert.equal(result.consistent, false);
  assert.equal(result.mismatches.length, 2);
  const missingOnChain = result.mismatches.find((m) => m.onChain === SIGNER_C);
  const extraInSnapshot = result.mismatches.find((m) => m.snapshot === SIGNER_B);
  assert.ok(missingOnChain, "expected C flagged as present on-chain only");
  assert.ok(extraInSnapshot, "expected B flagged as snapshot-only");
});

test("verifySnapshotConsistency - throws when no snapshot exists", async () => {
  const adapter = new MemorySnapshotAdapter();
  const service = new SnapshotService(adapter, undefined, {
    onChainProvider: stubProvider([SIGNER_A]),
  });

  await assert.rejects(
    () => service.verifySnapshotConsistency(CONTRACT_ID),
    /no snapshot found/i,
  );
});

test("verifySnapshotConsistency - throws when no on-chain provider is configured", async () => {
  const adapter = new MemorySnapshotAdapter();
  const service = new SnapshotService(adapter);

  await seedSigners(service, [SIGNER_A]);

  await assert.rejects(
    () => service.verifySnapshotConsistency(CONTRACT_ID),
    /on-chain config provider/i,
  );
});

test("verifySnapshotConsistency - propagates on-chain provider errors", async () => {
  const adapter = new MemorySnapshotAdapter();
  const failingProvider: OnChainConfigProvider = {
    async getVaultConfig() {
      throw new Error("RPC simulation failed");
    },
  };
  const service = new SnapshotService(adapter, undefined, {
    onChainProvider: failingProvider,
  });

  await seedSigners(service, [SIGNER_A]);

  await assert.rejects(
    () => service.verifySnapshotConsistency(CONTRACT_ID),
    /RPC simulation failed/,
  );
});

test("verifySnapshotConsistency - emitter failure does not fail verification", async () => {
  const adapter = new MemorySnapshotAdapter();
  const throwingEmitter: SnapshotVerificationEmitter = {
    async deliver() {
      throw new Error("webhook down");
    },
  };
  const service = new SnapshotService(adapter, undefined, {
    onChainProvider: stubProvider([SIGNER_A]),
    verificationEmitter: throwingEmitter,
  });

  await seedSigners(service, [SIGNER_A]);

  // Should resolve normally despite the emitter throwing.
  const result = await service.verifySnapshotConsistency(CONTRACT_ID);
  assert.equal(result.consistent, true);
});

test("verifySnapshotConsistency - works without an emitter configured", async () => {
  const adapter = new MemorySnapshotAdapter();
  const service = new SnapshotService(adapter, undefined, {
    onChainProvider: stubProvider([SIGNER_A]),
  });

  await seedSigners(service, [SIGNER_A]);

  const result = await service.verifySnapshotConsistency(CONTRACT_ID);
  assert.equal(result.consistent, true);
});
