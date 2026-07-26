/**
 * VaultDAO SDK — Mock Contract for Testing
 *
 * In-memory implementation of VaultDAO contract interface for unit testing.
 * Supports deterministic failure injection and ledger/time progression controls.
 *
 * Usage:
 * ```ts
 * const mock = new MockVaultContract();
 * mock.initialize("GXXX", { signers: [...], threshold: 2, ... });
 *
 * // Simulate a specific failure for testing error handling
 * mock.injectFailure("proposeTransfer", "InsufficientBalance");
 *
 * // Advance simulated ledger/time
 * mock.advanceLedger(100);
 * mock.advanceTime(86400000); // 1 day in ms
 *
 * // Use in tests; all methods return the same types as the real contract
 * ```
 */

import type {
  InitConfig,
  VaultConfig,
  Proposal,
  RecurringPayment,
  StreamingPayment,
  Subscription,
  Escrow,
  ProposalTemplate,
  Comment,
  VaultMetrics,
  Reputation,
  AuditEntry,
  SdkOptions,
  SdkLogger,
} from "./types";
import { Role, ProposalStatus, VaultError, VaultErrorCode, noopLogger } from "./types";

// ---------------------------------------------------------------------------
// Internal Types
// ---------------------------------------------------------------------------

interface InternalProposal extends Proposal {
  approvalCount: number;
}

interface InternalRecurringPayment extends RecurringPayment {
  createdAt: bigint;
}

/**
 * Failure injection configuration.
 * Allows tests to deterministically trigger specific errors.
 */
export interface FailureInjectionConfig {
  method: string;
  errorCode: VaultErrorCode;
  message?: string;
}

// ---------------------------------------------------------------------------
// Mock Contract Implementation
// ---------------------------------------------------------------------------

export class MockVaultContract {
  private isInitialized = false;
  private config: VaultConfig | null = null;
  private roles: Map<string, Role> = new Map();
  private proposals: Map<bigint, InternalProposal> = new Map();
  private recurringPayments: Map<bigint, InternalRecurringPayment> = new Map();
  private streamingPayments: Map<bigint, StreamingPayment> = new Map();
  private subscriptions: Map<bigint, Subscription> = new Map();
  private escrows: Map<bigint, Escrow> = new Map();
  private templates: Map<bigint, ProposalTemplate> = new Map();
  private comments: Map<bigint, Comment> = new Map();
  private metrics: VaultMetrics | null = null;

  // Counter for auto-incrementing IDs
  private proposalIdCounter = 1n;
  private recurringIdCounter = 1n;
  private streamIdCounter = 1n;
  private subscriptionIdCounter = 1n;
  private escrowIdCounter = 1n;
  private templateIdCounter = 1n;
  private commentIdCounter = 1n;

  // Time/ledger controls for testing
  private currentLedger = 0n;
  private currentTime = BigInt(Date.now());

  // Failure injection
  private failureInjections: Map<string, FailureInjectionConfig> = new Map();

  // Logger
  private logger: SdkLogger;

  constructor(logger?: SdkLogger) {
    this.logger = logger ?? noopLogger;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Control Interface
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Advance the mock ledger by N sequences (~5s per ledger).
   */
  public advanceLedger(count: bigint | number): void {
    const n = typeof count === "number" ? BigInt(count) : count;
    this.currentLedger += n;
    this.logger.debug("Mock ledger advanced", { newLedger: this.currentLedger });
  }

  /**
   * Advance the mock time (internal clock) by milliseconds.
   */
  public advanceTime(ms: number | bigint): void {
    const delta = typeof ms === "number" ? BigInt(ms) : ms;
    this.currentTime += delta;
    this.logger.debug("Mock time advanced", { newTime: this.currentTime });
  }

  /**
   * Set the current ledger sequence.
   */
  public setLedger(ledger: bigint | number): void {
    this.currentLedger = typeof ledger === "number" ? BigInt(ledger) : ledger;
    this.logger.debug("Mock ledger set", { ledger: this.currentLedger });
  }

  /**
   * Set the current time (milliseconds since epoch).
   */
  public setTime(ms: bigint | number): void {
    this.currentTime = typeof ms === "number" ? BigInt(ms) : ms;
    this.logger.debug("Mock time set", { time: this.currentTime });
  }

  /**
   * Inject a deterministic failure for a specific method.
   * The next invocation of that method will throw the specified error.
   */
  public injectFailure(
    method: string,
    errorCode: VaultErrorCode,
    message?: string
  ): void {
    this.failureInjections.set(method, {
      method,
      errorCode,
      message: message ?? `Injected error: ${errorCode}`,
    });
    this.logger.debug("Failure injected", { method, errorCode });
  }

  /**
   * Clear all failure injections.
   */
  public clearFailures(): void {
    this.failureInjections.clear();
    this.logger.debug("All failure injections cleared");
  }

  /**
   * Get current mock state (for assertions in tests).
   */
  public getState() {
    return {
      isInitialized: this.isInitialized,
      config: this.config,
      currentLedger: this.currentLedger,
      currentTime: this.currentTime,
      proposalCount: this.proposals.size,
      recurringPaymentCount: this.recurringPayments.size,
      roleCount: this.roles.size,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Contract Methods
  // ─────────────────────────────────────────────────────────────────────────

  private checkFailure(methodName: string): void {
    const failure = this.failureInjections.get(methodName);
    if (failure) {
      this.failureInjections.delete(methodName);
      this.logger.warn("Injected failure triggered", {
        method: methodName,
        errorCode: failure.errorCode,
      });
      throw new VaultError(failure.errorCode, failure.message);
    }
  }

  /**
   * Initialize the vault (once).
   */
  public initialize(adminPublicKey: string, config: InitConfig): void {
    this.checkFailure("initialize");

    if (this.isInitialized) {
      throw new VaultError(VaultErrorCode.AlreadyInitialized, "Vault already initialized");
    }

    this.config = {
      signers: [...config.signers],
      threshold: config.threshold,
      spendingLimit: config.spendingLimit,
      dailyLimit: config.dailyLimit,
      weeklyLimit: config.weeklyLimit,
      timelockThreshold: config.timelockThreshold,
      timelockDelay: config.timelockDelay,
    };

    this.roles.set(adminPublicKey, Role.Admin);
    this.isInitialized = true;
    this.logger.info("Mock vault initialized", { adminPublicKey });
  }

  /**
   * Get vault configuration.
   */
  public getConfig(): VaultConfig {
    this.checkFailure("getConfig");

    if (!this.config) {
      throw new VaultError(VaultErrorCode.NotInitialized, "Vault not initialized");
    }

    return { ...this.config };
  }

  /**
   * Get a proposal by ID.
   */
  public getProposal(id: bigint): Proposal {
    this.checkFailure("getProposal");

    const proposal = this.proposals.get(id);
    if (!proposal) {
      throw new VaultError(VaultErrorCode.ProposalNotFound, `Proposal ${id} not found`);
    }

    const { approvalCount, ...rest } = proposal;
    return rest;
  }

  /**
   * Get caller's role.
   */
  public getRole(callerPublicKey: string): Role {
    this.checkFailure("getRole");

    const role = this.roles.get(callerPublicKey);
    if (role === undefined) {
      return Role.Member; // Default to Member if no role assigned
    }
    return role;
  }

  /**
   * Propose a transfer.
   */
  public proposeTransfer(
    proposerPublicKey: string,
    recipient: string,
    token: string,
    amount: bigint,
    memo: string
  ): Proposal {
    this.checkFailure("proposeTransfer");

    if (!this.config) {
      throw new VaultError(VaultErrorCode.NotInitialized, "Vault not initialized");
    }

    const role = this.getRole(proposerPublicKey);
    if (role !== Role.Treasurer && role !== Role.Admin) {
      throw new VaultError(VaultErrorCode.InsufficientRole, "Only treasurers can propose transfers");
    }

    if (amount > this.config.spendingLimit) {
      throw new VaultError(VaultErrorCode.ExceedsProposalLimit, "Amount exceeds spending limit");
    }

    const id = this.proposalIdCounter++;
    const createdAt = this.currentLedger;
    const expiresAt = this.currentLedger + 30240n; // ~7 days

    const proposal: InternalProposal = {
      id,
      proposer: proposerPublicKey,
      recipient,
      token,
      amount,
      memo,
      approvals: [proposerPublicKey],
      status: ProposalStatus.Pending,
      createdAt,
      expiresAt,
      unlockLedger: amount > this.config.timelockThreshold
        ? this.currentLedger + this.config.timelockDelay
        : 0n,
      approvalCount: 1,
    };

    this.proposals.set(id, proposal);
    this.logger.info("Proposal created", { proposalId: id, amount });

    const { approvalCount, ...rest } = proposal;
    return rest;
  }

  /**
   * Approve a proposal.
   */
  public approveProposal(
    approverPublicKey: string,
    proposalId: bigint
  ): Proposal {
    this.checkFailure("approveProposal");

    if (!this.config) {
      throw new VaultError(VaultErrorCode.NotInitialized, "Vault not initialized");
    }

    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new VaultError(VaultErrorCode.ProposalNotFound, `Proposal ${proposalId} not found`);
    }

    const role = this.getRole(approverPublicKey);
    if (role !== Role.Treasurer && role !== Role.Admin) {
      throw new VaultError(VaultErrorCode.InsufficientRole, "Only treasurers can approve");
    }

    if (proposal.approvals.includes(approverPublicKey)) {
      throw new VaultError(VaultErrorCode.AlreadyApproved, "Already approved by this signer");
    }

    proposal.approvals.push(approverPublicKey);
    proposal.approvalCount++;

    if (proposal.approvalCount >= this.config.threshold) {
      proposal.status = ProposalStatus.Approved;
    }

    this.logger.info("Proposal approved", { proposalId, approvalCount: proposal.approvalCount });

    const { approvalCount, ...rest } = proposal;
    return rest;
  }

  /**
   * Execute a proposal.
   */
  public executeProposal(
    executorPublicKey: string,
    proposalId: bigint
  ): Proposal {
    this.checkFailure("executeProposal");

    if (!this.config) {
      throw new VaultError(VaultErrorCode.NotInitialized, "Vault not initialized");
    }

    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new VaultError(VaultErrorCode.ProposalNotFound, `Proposal ${proposalId} not found`);
    }

    if (proposal.status !== ProposalStatus.Approved) {
      throw new VaultError(VaultErrorCode.ProposalNotApproved, "Proposal must be approved");
    }

    if (proposal.unlockLedger > 0n && this.currentLedger < proposal.unlockLedger) {
      throw new VaultError(
        VaultErrorCode.TimelockNotExpired,
        `Timelock expires at ledger ${proposal.unlockLedger}`
      );
    }

    proposal.status = ProposalStatus.Executed;
    this.logger.info("Proposal executed", { proposalId, amount: proposal.amount });

    const { approvalCount, ...rest } = proposal;
    return rest;
  }

  /**
   * Reject a proposal.
   */
  public rejectProposal(
    rejecterPublicKey: string,
    proposalId: bigint
  ): Proposal {
    this.checkFailure("rejectProposal");

    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new VaultError(VaultErrorCode.ProposalNotFound, `Proposal ${proposalId} not found`);
    }

    if (proposal.status === ProposalStatus.Executed) {
      throw new VaultError(VaultErrorCode.ProposalAlreadyExecuted, "Cannot reject executed proposal");
    }

    proposal.status = ProposalStatus.Rejected;
    this.logger.info("Proposal rejected", { proposalId });

    const { approvalCount, ...rest } = proposal;
    return rest;
  }

  /**
   * Set a role for a user.
   */
  public setRole(callerPublicKey: string, targetPublicKey: string, role: Role): void {
    this.checkFailure("setRole");

    const callerRole = this.getRole(callerPublicKey);
    if (callerRole !== Role.Admin) {
      throw new VaultError(VaultErrorCode.Unauthorized, "Only admins can set roles");
    }

    this.roles.set(targetPublicKey, role);
    this.logger.info("Role set", { target: targetPublicKey, role });
  }

  /**
   * Create a recurring payment.
   */
  public schedulePayment(
    proposerPublicKey: string,
    recipient: string,
    token: string,
    amount: bigint,
    memo: string,
    intervalLedgers: bigint
  ): RecurringPayment {
    this.checkFailure("schedulePayment");

    if (!this.config) {
      throw new VaultError(VaultErrorCode.NotInitialized, "Vault not initialized");
    }

    const role = this.getRole(proposerPublicKey);
    if (role !== Role.Treasurer && role !== Role.Admin) {
      throw new VaultError(VaultErrorCode.InsufficientRole, "Only treasurers can schedule");
    }

    if (intervalLedgers < 720n) {
      throw new VaultError(VaultErrorCode.IntervalTooShort, "Interval must be at least 720 ledgers");
    }

    const id = this.recurringIdCounter++;

    const payment: InternalRecurringPayment = {
      id,
      proposer: proposerPublicKey,
      recipient,
      token,
      amount,
      memo,
      interval: intervalLedgers,
      nextPaymentLedger: this.currentLedger + intervalLedgers,
      paymentCount: 0,
      isActive: true,
      createdAt: this.currentLedger,
    };

    this.recurringPayments.set(id, payment);
    this.logger.info("Recurring payment scheduled", { paymentId: id, interval: intervalLedgers });

    const { createdAt, ...rest } = payment;
    return rest;
  }

  /**
   * Get a recurring payment.
   */
  public getRecurringPayment(id: bigint): RecurringPayment {
    this.checkFailure("getRecurringPayment");

    const payment = this.recurringPayments.get(id);
    if (!payment) {
      throw new VaultError(VaultErrorCode.ProposalNotFound, `Recurring payment ${id} not found`);
    }

    const { createdAt, ...rest } = payment;
    return rest;
  }

  /**
   * Execute a recurring payment.
   */
  public executeRecurringPayment(paymentId: bigint): RecurringPayment {
    this.checkFailure("executeRecurringPayment");

    const payment = this.recurringPayments.get(paymentId);
    if (!payment) {
      throw new VaultError(VaultErrorCode.ProposalNotFound, `Recurring payment ${paymentId} not found`);
    }

    if (!payment.isActive) {
      throw new VaultError(VaultErrorCode.ProposalNotPending, "Payment is not active");
    }

    if (this.currentLedger < payment.nextPaymentLedger) {
      throw new VaultError(
        VaultErrorCode.ProposalNotPending,
        `Payment not due until ledger ${payment.nextPaymentLedger}`
      );
    }

    payment.nextPaymentLedger = this.currentLedger + payment.interval;
    payment.paymentCount++;

    this.logger.info("Recurring payment executed", { paymentId, count: payment.paymentCount });

    const { createdAt, ...rest } = payment;
    return rest;
  }

  /**
   * Add a signer to the vault.
   */
  public addSigner(adminPublicKey: string, signerPublicKey: string): void {
    this.checkFailure("addSigner");

    const role = this.getRole(adminPublicKey);
    if (role !== Role.Admin) {
      throw new VaultError(VaultErrorCode.Unauthorized, "Only admins can add signers");
    }

    if (!this.config) {
      throw new VaultError(VaultErrorCode.NotInitialized, "Vault not initialized");
    }

    if (this.config.signers.includes(signerPublicKey)) {
      throw new VaultError(VaultErrorCode.SignerAlreadyExists, "Signer already exists");
    }

    this.config.signers.push(signerPublicKey);
    this.logger.info("Signer added", { signer: signerPublicKey });
  }

  /**
   * Remove a signer from the vault.
   */
  public removeSigner(adminPublicKey: string, signerPublicKey: string): void {
    this.checkFailure("removeSigner");

    const role = this.getRole(adminPublicKey);
    if (role !== Role.Admin) {
      throw new VaultError(VaultErrorCode.Unauthorized, "Only admins can remove signers");
    }

    if (!this.config) {
      throw new VaultError(VaultErrorCode.NotInitialized, "Vault not initialized");
    }

    const index = this.config.signers.indexOf(signerPublicKey);
    if (index === -1) {
      throw new VaultError(VaultErrorCode.SignerNotFound, "Signer not found");
    }

    this.config.signers.splice(index, 1);
    this.logger.info("Signer removed", { signer: signerPublicKey });
  }
}
