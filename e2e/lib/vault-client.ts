/**
 * Thin TypeScript wrapper for invoking the deployed VaultDAO contract
 * over Soroban RPC.
 *
 * Each method:
 *  1. Builds an `invokeContractFunction` transaction.
 *  2. Simulates it (surfaces diagnostic events on failure).
 *  3. Assembles the authorisation footprint.
 *  4. Signs and submits.
 *  5. Polls until SUCCESS or throws on timeout / failure.
 */

import {
  Contract,
  Keypair,
  Networks,
  SorobanRpc,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { getRpcUrl, getNetworkPassphrase, sleep } from "./network.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TxResult {
  txHash: string;
  ledger: number;
}

export interface ProposeTxResult extends TxResult {
  proposalId: bigint;
}

export interface StreamTxResult extends TxResult {
  streamId: bigint;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 4_000;
const TX_TIMEOUT_MS = 60_000;

/** Address ScVal from a Stellar public key string. */
function addrVal(pubKey: string): xdr.ScVal {
  return nativeToScVal(pubKey, { type: "address" });
}

/** i128 ScVal from a bigint. */
function i128Val(n: bigint): xdr.ScVal {
  return nativeToScVal(n, { type: "i128" });
}

/** u64 ScVal from a bigint. */
function u64Val(n: bigint): xdr.ScVal {
  return nativeToScVal(n, { type: "u64" });
}

/** u32 ScVal from a number. */
function u32Val(n: number): xdr.ScVal {
  return nativeToScVal(n, { type: "u32" });
}

/** Symbol ScVal. */
function symVal(s: string): xdr.ScVal {
  return nativeToScVal(s, { type: "symbol" });
}

// ---------------------------------------------------------------------------
// VaultClient
// ---------------------------------------------------------------------------

export class VaultClient {
  private server: SorobanRpc.Server;
  private contract: Contract;
  private networkPassphrase: string;

  constructor(
    rpcUrl: string = getRpcUrl(),
    networkPassphrase: string = getNetworkPassphrase(),
    contractId: string
  ) {
    this.server = new SorobanRpc.Server(rpcUrl, { allowHttp: true });
    this.contract = new Contract(contractId);
    this.networkPassphrase = networkPassphrase;
  }

  // -------------------------------------------------------------------------
  // Core invocation plumbing
  // -------------------------------------------------------------------------

  private async invoke(
    sourceKeypair: Keypair,
    method: string,
    args: xdr.ScVal[]
  ): Promise<TxResult & { returnVal: xdr.ScVal }> {
    const account = await this.server.getAccount(sourceKeypair.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(this.contract.call(method, ...args))
      .setTimeout(300)
      .build();

    // Simulate to get the resource footprint and auth entries.
    const simResult = await this.server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simResult)) {
      throw new Error(
        `Simulation failed for ${method}: ${simResult.error}\n` +
          `Events: ${JSON.stringify(simResult.events ?? [])}`
      );
    }

    const assembled = SorobanRpc.assembleTransaction(tx, simResult).build();
    assembled.sign(sourceKeypair);

    const submitResult = await this.server.sendTransaction(assembled);
    if (submitResult.status === "ERROR") {
      throw new Error(
        `Submit failed for ${method}: ${JSON.stringify(submitResult.errorResult)}`
      );
    }

    const txHash = submitResult.hash;

    // Poll for confirmation.
    const deadline = Date.now() + TX_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const status = await this.server.getTransaction(txHash);
      if (status.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
        const ledger = status.ledger;
        const returnVal =
          status.returnValue ?? xdr.ScVal.scvVoid();
        return { txHash, ledger, returnVal };
      }
      if (status.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
        throw new Error(
          `Transaction ${txHash} failed on-chain (method: ${method})`
        );
      }
    }
    throw new Error(
      `Transaction ${txHash} not confirmed within ${TX_TIMEOUT_MS / 1000}s`
    );
  }

  // -------------------------------------------------------------------------
  // Contract methods
  // -------------------------------------------------------------------------

  async initialize(
    sourceKeypair: Keypair,
    adminPubKey: string,
    signerPubKeys: string[],
    threshold: number,
    spendingLimit: bigint,
    dailyLimit: bigint,
    weeklyLimit: bigint
  ): Promise<TxResult> {
    // Build the InitConfig struct as a map ScVal.
    // We pass a minimal but valid InitConfig — optional fields use safe defaults.
    const signersVec = xdr.ScVal.scvVec(signerPubKeys.map(addrVal));
    const emptyVec = xdr.ScVal.scvVec([]);

    const initConfig = nativeToScVal(
      {
        signers: signerPubKeys,
        threshold,
        quorum: 0,
        quorum_percentage: 0,
        spending_limit: spendingLimit,
        daily_limit: dailyLimit,
        weekly_limit: weeklyLimit,
        timelock_threshold: BigInt("999999999999"),
        timelock_delay: 0n,
        velocity_limit: { limit: 10_000, window: 3_600n, per_token_limit: 0 },
        threshold_strategy: { tag: "Fixed", values: [] },
        default_voting_deadline: 0n,
        veto_addresses: [],
        veto_window_ledgers: 0n,
        retry_config: {
          enabled: false,
          max_retries: 0,
          initial_backoff_ledgers: 0n,
          max_retry_delay: 0n,
        },
        recovery_config: { guardians: [], threshold: 0, delay_ledgers: 0n },
        staking_config: {
          enabled: false,
          min_stake_bps: 0,
          slash_bps: 0,
          lock_ledgers: 0n,
        },
        pre_execution_hooks: [],
        post_execution_hooks: [],
        proposal_id_prefix: 0n,
        whitelist_mode: false,
        grace_period_ledgers: 100n,
        vote_weight: { tag: "Flat", values: [] },
        high_impact_threshold: 70,
        admin_rotation_delay: 1_440n,
      }
    );

    const { txHash, ledger } = await this.invoke(
      sourceKeypair,
      "initialize",
      [addrVal(adminPubKey), initConfig]
    );
    return { txHash, ledger };
  }

  async setRole(
    sourceKeypair: Keypair,
    adminPubKey: string,
    targetPubKey: string,
    role: "Admin" | "Treasurer" | "Member" | "Observer" | "DisputeArbitrator"
  ): Promise<TxResult> {
    const roleVal = nativeToScVal({ tag: role, values: [] });
    const { txHash, ledger } = await this.invoke(
      sourceKeypair,
      "set_role",
      [addrVal(adminPubKey), addrVal(targetPubKey), roleVal]
    );
    return { txHash, ledger };
  }

  async proposeTransfer(
    sourceKeypair: Keypair,
    proposerPubKey: string,
    recipientPubKey: string,
    tokenPubKey: string,
    amount: bigint
  ): Promise<ProposeTxResult> {
    const priorityVal = nativeToScVal({ tag: "Normal", values: [] });
    const condLogicVal = nativeToScVal({ tag: "And", values: [] });
    const emptyVec = xdr.ScVal.scvVec([]);

    const { txHash, ledger, returnVal } = await this.invoke(
      sourceKeypair,
      "propose_transfer",
      [
        addrVal(proposerPubKey),
        addrVal(recipientPubKey),
        addrVal(tokenPubKey),
        i128Val(amount),
        symVal("e2e"),
        priorityVal,
        emptyVec,       // conditions
        condLogicVal,
        i128Val(0n),    // insurance_amount
      ]
    );
    const proposalId = BigInt(scValToNative(returnVal) as number);
    return { txHash, ledger, proposalId };
  }

  async approveProposal(
    sourceKeypair: Keypair,
    signerPubKey: string,
    proposalId: bigint
  ): Promise<TxResult> {
    const { txHash, ledger } = await this.invoke(
      sourceKeypair,
      "approve_proposal",
      [addrVal(signerPubKey), u64Val(proposalId)]
    );
    return { txHash, ledger };
  }

  async executeProposal(
    sourceKeypair: Keypair,
    signerPubKey: string,
    proposalId: bigint
  ): Promise<TxResult> {
    const { txHash, ledger } = await this.invoke(
      sourceKeypair,
      "execute_proposal",
      [addrVal(signerPubKey), u64Val(proposalId)]
    );
    return { txHash, ledger };
  }

  async cancelProposal(
    sourceKeypair: Keypair,
    callerPubKey: string,
    proposalId: bigint,
    reason: string
  ): Promise<TxResult> {
    const { txHash, ledger } = await this.invoke(
      sourceKeypair,
      "cancel_proposal",
      [addrVal(callerPubKey), u64Val(proposalId), symVal(reason)]
    );
    return { txHash, ledger };
  }

  async createStream(
    sourceKeypair: Keypair,
    senderPubKey: string,
    recipientPubKey: string,
    tokenPubKey: string,
    rate: bigint,
    totalAmount: bigint,
    durationSecs: bigint
  ): Promise<StreamTxResult> {
    const { txHash, ledger, returnVal } = await this.invoke(
      sourceKeypair,
      "create_stream",
      [
        addrVal(senderPubKey),
        addrVal(recipientPubKey),
        addrVal(tokenPubKey),
        i128Val(rate),
        i128Val(totalAmount),
        u64Val(durationSecs),
      ]
    );
    const streamId = BigInt(scValToNative(returnVal) as number);
    return { txHash, ledger, streamId };
  }

  async pauseStream(
    sourceKeypair: Keypair,
    callerPubKey: string,
    streamId: bigint
  ): Promise<TxResult> {
    const { txHash, ledger } = await this.invoke(
      sourceKeypair,
      "pause_stream",
      [addrVal(callerPubKey), u64Val(streamId)]
    );
    return { txHash, ledger };
  }

  async resumeStream(
    sourceKeypair: Keypair,
    callerPubKey: string,
    streamId: bigint
  ): Promise<TxResult> {
    const { txHash, ledger } = await this.invoke(
      sourceKeypair,
      "resume_stream",
      [addrVal(callerPubKey), u64Val(streamId)]
    );
    return { txHash, ledger };
  }

  async cancelStream(
    sourceKeypair: Keypair,
    callerPubKey: string,
    streamId: bigint
  ): Promise<TxResult> {
    const { txHash, ledger } = await this.invoke(
      sourceKeypair,
      "cancel_stream",
      [addrVal(callerPubKey), u64Val(streamId)]
    );
    return { txHash, ledger };
  }

  async claimStream(
    sourceKeypair: Keypair,
    recipientPubKey: string,
    streamId: bigint
  ): Promise<TxResult> {
    const { txHash, ledger } = await this.invoke(
      sourceKeypair,
      "claim_stream",
      [addrVal(recipientPubKey), u64Val(streamId)]
    );
    return { txHash, ledger };
  }

  /** Read-only: get a proposal (uses simulateTransaction, no fee). */
  async getProposal(proposalId: bigint): Promise<Record<string, unknown>> {
    const dummyKeypair = Keypair.random();
    // getAccount will fail for a random key — use a minimal ledger query instead.
    // For read-only calls we simulate with a dummy source that need not exist.
    const account = await this.server
      .getAccount(dummyKeypair.publicKey())
      .catch(() => ({
        accountId: () => dummyKeypair.publicKey(),
        sequenceNumber: () => "0",
        incrementSequenceNumber: () => {},
      }));

    const tx = new TransactionBuilder(account as Parameters<typeof TransactionBuilder>[0], {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(this.contract.call("get_proposal", u64Val(proposalId)))
      .setTimeout(30)
      .build();

    const sim = await this.server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(sim)) {
      throw new Error(`get_proposal simulation failed: ${sim.error}`);
    }
    if (!("result" in sim) || !sim.result) {
      throw new Error("get_proposal returned no result");
    }
    return scValToNative(sim.result.retval) as Record<string, unknown>;
  }

  /** Read-only: get a stream. */
  async getStream(streamId: bigint): Promise<Record<string, unknown>> {
    const dummyKeypair = Keypair.random();
    const account = await this.server
      .getAccount(dummyKeypair.publicKey())
      .catch(() => ({
        accountId: () => dummyKeypair.publicKey(),
        sequenceNumber: () => "0",
        incrementSequenceNumber: () => {},
      }));

    const tx = new TransactionBuilder(account as Parameters<typeof TransactionBuilder>[0], {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(this.contract.call("get_stream", u64Val(streamId)))
      .setTimeout(30)
      .build();

    const sim = await this.server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(sim)) {
      throw new Error(`get_stream simulation failed: ${sim.error}`);
    }
    if (!("result" in sim) || !sim.result) {
      throw new Error("get_stream returned no result");
    }
    return scValToNative(sim.result.retval) as Record<string, unknown>;
  }

  /** Read-only: get a cancellation record. */
  async getCancellationRecord(
    proposalId: bigint
  ): Promise<Record<string, unknown> | null> {
    const dummyKeypair = Keypair.random();
    const account = await this.server
      .getAccount(dummyKeypair.publicKey())
      .catch(() => ({
        accountId: () => dummyKeypair.publicKey(),
        sequenceNumber: () => "0",
        incrementSequenceNumber: () => {},
      }));

    const tx = new TransactionBuilder(account as Parameters<typeof TransactionBuilder>[0], {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        this.contract.call("get_cancellation_record", u64Val(proposalId))
      )
      .setTimeout(30)
      .build();

    const sim = await this.server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(sim)) return null;
    if (!("result" in sim) || !sim.result) return null;
    const native = scValToNative(sim.result.retval);
    return native as Record<string, unknown>;
  }
}
