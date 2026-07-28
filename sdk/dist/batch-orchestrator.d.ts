/**
 * Batch Transaction Orchestrator
 *
 * Simplifies orchestration of batch proposal operations (create, approve, execute).
 * Uses builder pattern for fluent API and tracks state across operations.
 */
import type { SdkOptions } from "./types.js";
/**
 * Transfer configuration for batch proposal.
 */
export interface BatchTransfer {
    readonly recipientPublicKey: string;
    readonly tokenAddress: string;
    readonly amount: bigint;
    readonly description?: string;
}
/**
 * Orchestration state tracking.
 */
interface OrchestrationState {
    readonly transfers: BatchTransfer[];
    readonly createdProposalIds: string[];
    readonly approvalCounts: Map<string, number>;
    readonly executedProposalIds: string[];
    readonly errors: Array<{
        step: string;
        error: string;
    }>;
}
/**
 * Retry configuration for failed operations.
 */
export interface RetryConfig {
    maxAttempts: number;
    initialBackoffMs: number;
    maxBackoffMs: number;
}
/**
 * BatchProposalOrchestrator
 *
 * Orchestrates creating, approving, and executing multiple proposals
 * in a controlled manner with retry logic and state tracking.
 */
export declare class BatchProposalOrchestrator {
    private state;
    private readonly options;
    private readonly retryConfig;
    /**
     * Create a new batch orchestrator.
     *
     * @param opts SDK options (contractId, rpcUrl, etc.)
     * @param retryConfig Optional retry configuration (defaults provided)
     */
    constructor(opts: SdkOptions, retryConfig?: Partial<RetryConfig>);
    /**
     * Add a single transfer to the batch.
     * Returns this for chaining.
     */
    addTransfer(transfer: BatchTransfer): this;
    /**
     * Add multiple transfers to the batch.
     * Returns this for chaining.
     */
    addTransfers(transfers: BatchTransfer[]): this;
    /**
     * Get the current list of transfers to be proposed.
     */
    getTransfers(): readonly BatchTransfer[];
    /**
     * Manually add a created proposal ID to the orchestrator.
     * Call this after proposals are indexed from events.
     *
     * @param proposalId ID of the created proposal
     */
    addCreatedProposalId(proposalId: string): void;
    /**
     * Manually add multiple created proposal IDs to the orchestrator.
     *
     * @param proposalIds Array of proposal IDs
     */
    addCreatedProposalIds(proposalIds: string[]): void;
    /**
     * Get list of created proposal IDs.
     */
    getCreatedProposalIds(): readonly string[];
    /**
     * Get list of executed proposal IDs.
     */
    getExecutedProposalIds(): readonly string[];
    /**
     * Get orchestration errors encountered.
     */
    getErrors(): ReadonlyArray<{
        step: string;
        error: string;
    }>;
    /**
     * Get current orchestration state.
     */
    getState(): Readonly<OrchestrationState>;
    /**
     * Create proposals for all transfers using retry logic.
     * On failure, partially created proposals remain in state.
     *
     * @param proposerPublicKey Public key of proposer
     * @returns Array of created proposal IDs (populated externally from events)
     */
    createProposals(proposerPublicKey: string): Promise<string[]>;
    /**
     * Approve all created proposals from a given signer.
     * Retries failed approvals up to maxAttempts.
     *
     * @param signerPublicKey Public key of signer approving proposals
     * @returns Number of successful approvals
     */
    approveAllProposals(signerPublicKey: string): Promise<number>;
    /**
     * Approve a specific proposal.
     *
     * @param signerPublicKey Public key of signer
     * @param proposalId ID of proposal to approve (can be string or bigint)
     */
    approveProposal(signerPublicKey: string, proposalId: string | bigint): Promise<void>;
    /**
     * Execute all created proposals.
     * Retries failed executions up to maxAttempts.
     *
     * @param executorPublicKey Public key of executor
     * @returns Array of successfully executed proposal IDs
     */
    executeAllProposals(executorPublicKey: string): Promise<string[]>;
    /**
     * Execute a specific proposal.
     *
     * @param executorPublicKey Public key of executor
     * @param proposalId ID of proposal to execute (can be string or bigint)
     */
    executeProposal(executorPublicKey: string, proposalId: string | bigint): Promise<void>;
    /**
     * Execute the full orchestration: create → approve → execute.
     * Use individual methods for finer control.
     *
     * @param proposerPublicKey Public key of proposer
     * @param approverPublicKey Public key of approver (typically multi-sig)
     * @param executorPublicKey Public key of executor
     * @returns Orchestration result with counts and errors
     */
    executeFullOrchestration(proposerPublicKey: string, approverPublicKey: string, executorPublicKey: string): Promise<{
        created: number;
        approved: number;
        executed: number;
        failed: number;
        errors: ReadonlyArray<{
            step: string;
            error: string;
        }>;
    }>;
    /**
     * Reset orchestration state (clears transfers, proposals, errors).
     */
    reset(): void;
    /**
     * Internal: Retry a single operation with exponential backoff.
     */
    private retryOperation;
    /**
     * Internal: Record an error for diagnostics.
     */
    private recordError;
}
/**
 * Factory function to create a new batch orchestrator.
 *
 * @example
 * const orchestrator = createBatchOrchestrator(sdkOptions);
 * await orchestrator
 *   .addTransfer({ recipient, token, amount, description })
 *   .addTransfer({ ... })
 *   .executeFullOrchestration(proposer, approver, executor);
 */
export declare function createBatchOrchestrator(opts: SdkOptions, retryConfig?: Partial<RetryConfig>): BatchProposalOrchestrator;
export {};
//# sourceMappingURL=batch-orchestrator.d.ts.map