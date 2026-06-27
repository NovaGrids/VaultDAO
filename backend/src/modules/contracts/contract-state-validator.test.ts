import assert from "node:assert/strict";
import test from "node:test";
import { ContractStateValidator } from "./contract-state-validator.js";
import type { ContractRegistry } from "./contract-registry.js";
import type { VaultService } from "../vault/vault.service.js";

const CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

function makeRegistry(ids: string[] = [CONTRACT_ID]): ContractRegistry {
  return {
    list: () => ids.map((id) => ({ id, pollingStatus: "active" as const })),
    get: (id: string) => ids.includes(id) ? { id, pollingStatus: "active" as const } : undefined,
    discover: async () => [],
    register: () => ({ success: true }),
    updateLastLedger: () => {},
  } as unknown as ContractRegistry;
}

function makeVaultService(config: Partial<{
  signers: string[];
  threshold: number;
  spendingLimit: string;
}>): VaultService {
  return {
    getVaultConfig: async () => ({
      signers: config.signers ?? ["GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"],
      threshold: config.threshold ?? 2,
      spendingLimit: config.spendingLimit ?? "1000",
      dailyLimit: "5000",
      weeklyLimit: "25000",
      timelockThreshold: "500",
      timelockDelay: "200",
    }),
  } as unknown as VaultService;
}

test("ContractStateValidator: getDriftStatus returns is_drifted=false before first check", () => {
  const validator = new ContractStateValidator(makeRegistry(), makeVaultService({}));
  const status = validator.getDriftStatus(CONTRACT_ID);
  assert.equal(status.is_drifted, false);
  assert.equal(status.last_check, null);
  assert.deepEqual(status.drifted_fields, []);
});

test("ContractStateValidator: no drift when state matches baseline", async () => {
  const registry = makeRegistry();
  const service = makeVaultService({ signers: ["GABC"], threshold: 2 });
  const validator = new ContractStateValidator(registry, service, undefined, 999_999);

  // Trigger one check
  await (validator as any).checkAll();
  // Trigger second check with same config
  await (validator as any).checkAll();

  const status = validator.getDriftStatus(CONTRACT_ID);
  assert.equal(status.is_drifted, false);
  assert.deepEqual(status.drifted_fields, []);
  assert.ok(status.last_check !== null);
});

test("ContractStateValidator: detects drift when signers change", async () => {
  const registry = makeRegistry();
  let callCount = 0;
  const service: VaultService = {
    getVaultConfig: async () => {
      callCount++;
      return {
        signers: callCount === 1 ? ["GABC"] : ["GABC", "GXYZ"],
        threshold: 2,
        spendingLimit: "1000",
        dailyLimit: "5000",
        weeklyLimit: "25000",
        timelockThreshold: "500",
        timelockDelay: "200",
      };
    },
  } as unknown as VaultService;

  const validator = new ContractStateValidator(registry, service, undefined, 999_999);

  const driftEvents: any[] = [];
  validator.on("StateDriftDetected", (e) => driftEvents.push(e));

  // First check: establishes baseline
  await (validator as any).checkAll();
  // Second check: signers changed
  await (validator as any).checkAll();

  assert.equal(driftEvents.length, 1);
  assert.ok(driftEvents[0].driftedFields.includes("signers"));
});

test("ContractStateValidator: detects drift when threshold changes", async () => {
  const registry = makeRegistry();
  let callCount = 0;
  const service: VaultService = {
    getVaultConfig: async () => ({
      signers: ["GABC"],
      threshold: callCount++ === 0 ? 2 : 3,
      spendingLimit: "1000",
      dailyLimit: "5000",
      weeklyLimit: "25000",
      timelockThreshold: "500",
      timelockDelay: "200",
    }),
  } as unknown as VaultService;

  const validator = new ContractStateValidator(registry, service, undefined, 999_999);

  const driftEvents: any[] = [];
  validator.on("StateDriftDetected", (e) => driftEvents.push(e));

  await (validator as any).checkAll();
  await (validator as any).checkAll();

  assert.equal(driftEvents.length, 1);
  assert.ok(driftEvents[0].driftedFields.includes("threshold"));
});

test("ContractStateValidator: getAllDriftStatuses returns status for all contracts", async () => {
  const ids = [CONTRACT_ID, "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWHF"];
  const registry = makeRegistry(ids);
  const validator = new ContractStateValidator(registry, makeVaultService({}), undefined, 999_999);

  const statuses = validator.getAllDriftStatuses();
  assert.equal(statuses.length, 2);
  assert.ok(statuses.every((s) => s.is_drifted === false));
});

test("ContractStateValidator: isRunning reflects start/stop", () => {
  const validator = new ContractStateValidator(makeRegistry(), makeVaultService({}), undefined, 999_999);
  assert.equal(validator.isRunning(), false);
  validator.start();
  assert.equal(validator.isRunning(), true);
  validator.stop();
  assert.equal(validator.isRunning(), false);
});

test("ContractStateValidator: does not throw when RPC call fails", async () => {
  const registry = makeRegistry();
  const failService: VaultService = {
    getVaultConfig: async () => { throw new Error("RPC down"); },
  } as unknown as VaultService;

  const validator = new ContractStateValidator(registry, failService, undefined, 999_999);
  // Should not throw
  await assert.doesNotReject(() => (validator as any).checkAll());
});

test("ContractStateValidator: cache is refreshed after drift detected", async () => {
  const registry = makeRegistry();
  let callCount = 0;
  const configs = [
    ["GABC"],
    ["GABC", "GXYZ"],
    ["GABC", "GXYZ"], // same as second → no more drift
  ];
  const service: VaultService = {
    getVaultConfig: async () => ({
      signers: configs[callCount++] ?? ["GABC"],
      threshold: 2,
      spendingLimit: "1000",
      dailyLimit: "5000",
      weeklyLimit: "25000",
      timelockThreshold: "500",
      timelockDelay: "200",
    }),
  } as unknown as VaultService;

  const validator = new ContractStateValidator(registry, service, undefined, 999_999);
  const driftEvents: any[] = [];
  validator.on("StateDriftDetected", (e) => driftEvents.push(e));

  await (validator as any).checkAll(); // baseline
  await (validator as any).checkAll(); // drift
  await (validator as any).checkAll(); // no drift (refreshed)

  assert.equal(driftEvents.length, 1, "drift should fire only once");
});
