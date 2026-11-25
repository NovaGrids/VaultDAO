/**
 * VaultDAO SDK — Simulation helpers with resource estimates (#2064)
 *
 * Every helper simulates a contract invocation against a shared RPC client and
 * returns the decoded return value together with the resources the transaction
 * is expected to consume. This lets dashboards pre-flight governance actions
 * without paying a fee or waiting for ledger confirmation.
 */

import { rpc, TransactionBuilder, BASE_FEE, xdr } from "@stellar/stellar-sdk";
import type { SdkOptions, StateDiff } from "./types";
import { noopLogger } from "./types";
import { getRpcServer } from "./rpc";
import {
  decodeScVal,
  extractStateDiff,
  getContract,
  parseError,
  retryOnRateLimit,
} from "./utils";

/** Resource usage reported by the RPC for a simulated invocation. */
export interface ResourceEstimate {
  /** Simulated CPU instructions (from `cost.cpu_insns`). */
  cpuInstructions: bigint;
  /** Simulated memory bytes (from `cost.mem_bytes`). */
  memoryBytes: bigint;
  /** Minimum resource fee reported by the RPC, when available. */
  minResourceFee: bigint;
  /** Ledger the simulation was performed against. */
  latestLedger?: number;
}

/** Result of a simulation, including the decoded return value and resources. */
export interface SimulationEstimate<T = unknown> {
  /** Contract method that was simulated. */
  method: string;
  /** Decoded return value of the contract call. */
  result: T;
  /** Expected resource consumption. */
  resourceEstimate: ResourceEstimate;
  /** Storage keys read/written during simulation. */
  stateDiff: StateDiff;
}

function asBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" || typeof value === "string") {
    try {
      return BigInt(value);
    } catch {
      return 0n;
    }
  }
  return 0n;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function pick(record: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

/** Extract a normalised resource estimate from an RPC simulation response. */
export function extractResourceEstimate(sim: unknown): ResourceEstimate {
  const response = (sim ?? {}) as Record<string, unknown>;
  const cost = (response.cost ?? {}) as Record<string, unknown>;

  return {
    cpuInstructions: asBigInt(pick(cost, "cpuInsns", "cpu_insns", "cpuInstructions")),
    memoryBytes: asBigInt(pick(cost, "memBytes", "mem_bytes", "memoryBytes")),
    minResourceFee: asBigInt(
      pick(response, "minResourceFee", "min_resource_fee", "minResourceFees")
    ),
    latestLedger: asNumber(pick(response, "latestLedger", "latest_ledger")),
  };
}

/**
 * Simulate a contract invocation without submitting a transaction.
 *
 * @param method     - Contract method name, e.g. `"abstain_proposal"`.
 * @param args       - Already encoded ScVal arguments for the method.
 * @param opts       - Shared SDK connection options (reuses the RPC client).
 * @param sourceKey  - Public key used as the simulation's source account.
 */
export async function simulateContractCall<T = unknown>(
  method: string,
  args: xdr.ScVal[],
  opts: SdkOptions,
  sourceKey: string
): Promise<SimulationEstimate<T>> {
  const log = opts.logger ?? noopLogger;
  const server = getRpcServer(opts);
  const operation = getContract(opts).call(method, ...args);

  const sim = await retryOnRateLimit(
    async () => {
      const account = await server.getAccount(sourceKey);
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: opts.networkPassphrase,
      })
        .addOperation(operation)
        .setTimeout(15)
        .build();
      return server.simulateTransaction(tx);
    },
    opts,
    log,
    `simulate ${method}`
  );

  if (rpc.Api.isSimulationError(sim)) {
    throw parseError(new Error(sim.error));
  }
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) {
    throw new Error(`Simulation of ${method} returned no result`);
  }

  log.debug("Contract call simulated", {
    method,
    contractId: opts.contractId,
    ...extractResourceEstimate(sim),
  });

  return {
    method,
    result: decodeScVal(sim.result.retval) as T,
    resourceEstimate: extractResourceEstimate(sim),
    stateDiff: extractStateDiff(sim),
  };
}

// ---------------------------------------------------------------------------
// Family helpers (#2064) — all return `SimulationEstimate`
// ---------------------------------------------------------------------------

/** Vote variants: abstain / change / veto / cancel / amend. */
export type VoteMethod =
  | "abstain_proposal"
  | "change_vote"
  | "veto_proposal"
  | "cancel_proposal"
  | "amend_proposal";

export function simulateVote(
  method: VoteMethod,
  args: xdr.ScVal[],
  opts: SdkOptions,
  sourceKey: string
): Promise<SimulationEstimate> {
  return simulateContractCall(method, args, opts, sourceKey);
}

/** Emergency controls: pause / unpause. */
export type PauseMethod = "pause_vault" | "unpause_vault";

export function simulatePause(
  method: PauseMethod,
  args: xdr.ScVal[],
  opts: SdkOptions,
  sourceKey: string
): Promise<SimulationEstimate> {
  return simulateContractCall(method, args, opts, sourceKey);
}

/** Insurance claim governance. */
export type InsuranceMethod =
  | "submit_insurance_claim"
  | "vote_on_insurance_claim"
  | "close_insurance_claim_voting";

export function simulateInsurance(
  method: InsuranceMethod,
  args: xdr.ScVal[],
  opts: SdkOptions,
  sourceKey: string
): Promise<SimulationEstimate> {
  return simulateContractCall(method, args, opts, sourceKey);
}

/** Staking helpers. */
export type StakingMethod =
  | "enable_auto_compound"
  | "compound_stake"
  | "update_staking_config"
  | "propose_stake_withdrawal";

export function simulateStaking(
  method: StakingMethod,
  args: xdr.ScVal[],
  opts: SdkOptions,
  sourceKey: string
): Promise<SimulationEstimate> {
  return simulateContractCall(method, args, opts, sourceKey);
}

/** Recipient list / whitelist management. */
export type WhitelistMethod =
  | "set_list_mode"
  | "add_to_whitelist"
  | "remove_from_whitelist"
  | "add_to_blacklist"
  | "remove_from_blacklist"
  | "bulk_add_to_whitelist"
  | "bulk_remove_from_whitelist"
  | "bulk_add_to_blacklist"
  | "bulk_remove_from_blacklist";

export function simulateWhitelist(
  method: WhitelistMethod,
  args: xdr.ScVal[],
  opts: SdkOptions,
  sourceKey: string
): Promise<SimulationEstimate> {
  return simulateContractCall(method, args, opts, sourceKey);
}

/** Batch creation and execution. */
export type BatchMethod =
  | "create_batch"
  | "execute_batch"
  | "batch_execute_proposals"
  | "batch_propose_transfers"
  | "batch_approve_proposals";

export function simulateBatch(
  method: BatchMethod,
  args: xdr.ScVal[],
  opts: SdkOptions,
  sourceKey: string
): Promise<SimulationEstimate> {
  return simulateContractCall(method, args, opts, sourceKey);
}

/** Swap proposal execution and DEX configuration. */
export type SwapMethod = "propose_swap" | "execute_swap_proposal" | "set_dex_config";

export function simulateSwap(
  method: SwapMethod,
  args: xdr.ScVal[],
  opts: SdkOptions,
  sourceKey: string
): Promise<SimulationEstimate> {
  return simulateContractCall(method, args, opts, sourceKey);
}
