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
import type { InitConfig, VaultConfig, Proposal, RecurringPayment, SdkLogger, StateDiff } from "./types";
import { Role, VaultErrorCode } from "./types";
/**
 * Failure injection configuration.
 * Allows tests to deterministically trigger specific errors.
 */
export interface FailureInjectionConfig {
    method: string;
    errorCode: VaultErrorCode;
    message?: string;
}
export declare class MockVaultContract {
    private isInitialized;
    private config;
    private roles;
    private proposals;
    private recurringPayments;
    private streamingPayments;
    private subscriptions;
    private escrows;
    private templates;
    private comments;
    private metrics;
    private proposalIdCounter;
    private recurringIdCounter;
    private streamIdCounter;
    private subscriptionIdCounter;
    private escrowIdCounter;
    private templateIdCounter;
    private commentIdCounter;
    private currentLedger;
    private currentTime;
    private failureInjections;
    private logger;
    constructor(logger?: SdkLogger);
    /**
     * Advance the mock ledger by N sequences (~5s per ledger).
     */
    advanceLedger(count: bigint | number): void;
    /**
     * Advance the mock time (internal clock) by milliseconds.
     */
    advanceTime(ms: number | bigint): void;
    /**
     * Set the current ledger sequence.
     */
    setLedger(ledger: bigint | number): void;
    /**
     * Set the current time (milliseconds since epoch).
     */
    setTime(ms: bigint | number): void;
    /**
     * Inject a deterministic failure for a specific method.
     * The next invocation of that method will throw the specified error.
     */
    injectFailure(method: string, errorCode: VaultErrorCode, message?: string): void;
    /**
     * Clear all failure injections.
     */
    clearFailures(): void;
    /**
     * Get current mock state (for assertions in tests).
     */
    getState(): {
        isInitialized: boolean;
        config: VaultConfig | null;
        currentLedger: bigint;
        currentTime: bigint;
        proposalCount: number;
        recurringPaymentCount: number;
        roleCount: number;
    };
    private checkFailure;
    /**
     * Initialize the vault (once).
     */
    initialize(adminPublicKey: string, config: InitConfig): void;
    /**
     * Get vault configuration.
     */
    getConfig(): VaultConfig;
    /**
     * Get a proposal by ID.
     */
    getProposal(id: bigint): Proposal;
    /**
     * Get caller's role.
     */
    getRole(callerPublicKey: string): Role;
    /**
     * Propose a transfer.
     */
    proposeTransfer(proposerPublicKey: string, recipient: string, token: string, amount: bigint, memo: string): Proposal;
    /**
     * Approve a proposal.
     */
    approveProposal(approverPublicKey: string, proposalId: bigint): Proposal;
    /**
     * Execute a proposal.
     */
    executeProposal(executorPublicKey: string, proposalId: bigint): Proposal;
    /**
     * Reject a proposal.
     */
    rejectProposal(rejecterPublicKey: string, proposalId: bigint): Proposal;
    /**
     * Set a role for a user.
     */
    setRole(callerPublicKey: string, targetPublicKey: string, role: Role): void;
    /**
     * Create a recurring payment.
     */
    schedulePayment(proposerPublicKey: string, recipient: string, token: string, amount: bigint, memo: string, intervalLedgers: bigint): RecurringPayment;
    /**
     * Get a recurring payment.
     */
    getRecurringPayment(id: bigint): RecurringPayment;
    /**
     * Execute a recurring payment.
     */
    executeRecurringPayment(paymentId: bigint): RecurringPayment;
    /**
     * Add a signer to the vault.
     */
    addSigner(adminPublicKey: string, signerPublicKey: string): void;
    /**
     * Remove a signer from the vault.
     */
    removeSigner(adminPublicKey: string, signerPublicKey: string): void;
    /**
     * Simulate a transaction or mock action and return state diffs showing created and modified keys.
     */
    simulateWithStateDiff(tx: any): StateDiff;
    simulate_with_state_diff(tx: any): StateDiff;
}
//# sourceMappingURL=mock-contract.d.ts.map