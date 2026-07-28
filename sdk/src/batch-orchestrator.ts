/**
 * Batch Transaction Orchestrator
 *
 * Simplifies orchestration of batch proposal operations (create, approve, execute).
 * Uses builder pattern for fluent API and tracks state across operations.
 */

import type { SdkOptions } from "./types.js";
import { proposeTransfer, approveProposal, executeProposal } from "./contract.js";

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
  readonly errors: Array<{ step: string; error: string }>;
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
export class BatchProposalOrchestrator {
  private state: OrchestrationState;
  private readonly options: SdkOptions;
  private readonly retryConfig: RetryConfig;

  /**
   * Create a new batch orchestrator.
   *
   * @param opts SDK options (contractId, rpcUrl, etc.)
   * @param retryConfig Optional retry configuration (defaults provided)
   */
  constructor(
    opts: SdkOptions,
    retryConfig?: Partial<RetryConfig>,
  ) {
    this.options = opts;
    this.state = {
      transfers: [],
      createdProposalIds: [],
      approvalCounts: new Map(),
      executedProposalIds: [],
      errors: [],
    };

    this.retryConfig = {
      maxAttempts: retryConfig?.maxAttempts ?? 3,
      initialBackoffMs: retryConfig?.initialBackoffMs ?? 1000,
      maxBackoffMs: retryConfig?.maxBackoffMs ?? 10000,
    };
  }

  /**
   * Add a single transfer to the batch.
   * Returns this for chaining.
   */
  public addTransfer(transfer: BatchTransfer): this {
    this.state.transfers.push(transfer);
    return this;
  }

  /**
   * Add multiple transfers to the batch.
   * Returns this for chaining.
   */
  public addTransfers(transfers: BatchTransfer[]): this {
    this.state.transfers.push(...transfers);
    return this;
  }

  /**
   * Get the current list of transfers to be proposed.
   */
  public getTransfers(): readonly BatchTransfer[] {
    return this.state.transfers;
  }

  /**
   * Manually add a created proposal ID to the orchestrator.
   * Call this after proposals are indexed from events.
   *
   * @param proposalId ID of the created proposal
   */
  public addCreatedProposalId(proposalId: string): void {
    if (!this.state.createdProposalIds.includes(proposalId)) {
      this.state.createdProposalIds.push(proposalId);
      this.state.approvalCounts.set(proposalId, 0);
    }
  }

  /**
   * Manually add multiple created proposal IDs to the orchestrator.
   *
   * @param proposalIds Array of proposal IDs
   */
  public addCreatedProposalIds(proposalIds: string[]): void {
    for (const id of proposalIds) {
      this.addCreatedProposalId(id);
    }
  }

  /**
   * Get list of created proposal IDs.
   */
  public getCreatedProposalIds(): readonly string[] {
    return this.state.createdProposalIds;
  }

  /**
   * Get list of executed proposal IDs.
   */
  public getExecutedProposalIds(): readonly string[] {
    return this.state.executedProposalIds;
  }

  /**
   * Get orchestration errors encountered.
   */
  public getErrors(): ReadonlyArray<{ step: string; error: string }> {
    return this.state.errors;
  }

  /**
   * Get current orchestration state.
   */
  public getState(): Readonly<OrchestrationState> {
    return this.state;
  }

  /**
   * Create proposals for all transfers using retry logic.
   * On failure, partially created proposals remain in state.
   *
   * @param proposerPublicKey Public key of proposer
   * @returns Array of created proposal IDs (populated externally from events)
   */
  public async createProposals(proposerPublicKey: string): Promise<string[]> {
    const txnHashes: string[] = [];

    for (const transfer of this.state.transfers) {
      try {
        const txn = await this.retryOperation(
          async () => {
            return await proposeTransfer(
              proposerPublicKey,
              transfer.recipientPublicKey,
              transfer.tokenAddress,
              transfer.amount,
              transfer.description ?? "",
              this.options,
            );
          },
          `create-proposal-${transfer.recipientPublicKey}`,
        );

        // The transaction XDR is returned, not a proposal ID
        // In production, you would sign/submit and extract the proposalId from events
        txnHashes.push(txn.substring(0, 32)); // Use truncated hash as temp ID for tracking
      } catch (error) {
        this.recordError("create-proposal", String(error));
      }
    }

    return txnHashes;
  }

  /**
   * Approve all created proposals from a given signer.
   * Retries failed approvals up to maxAttempts.
   *
   * @param signerPublicKey Public key of signer approving proposals
   * @returns Number of successful approvals
   */
  public async approveAllProposals(signerPublicKey: string): Promise<number> {
    let successCount = 0;

    for (const proposalId of this.state.createdProposalIds) {
      try {
        await this.retryOperation(
          async () => {
            await approveProposal(
              signerPublicKey,
              BigInt(proposalId),
              this.options,
            );
          },
          `approve-proposal-${proposalId}`,
        );

        const count = this.state.approvalCounts.get(proposalId) ?? 0;
        this.state.approvalCounts.set(proposalId, count + 1);
        successCount++;
      } catch (error) {
        this.recordError("approve-proposal", String(error));
      }
    }

    return successCount;
  }

  /**
   * Approve a specific proposal.
   *
   * @param signerPublicKey Public key of signer
   * @param proposalId ID of proposal to approve (can be string or bigint)
   */
  public async approveProposal(
    signerPublicKey: string,
    proposalId: string | bigint,
  ): Promise<void> {
    try {
      await this.retryOperation(
        async () => {
          await approveProposal(
            signerPublicKey,
            typeof proposalId === "string" ? BigInt(proposalId) : proposalId,
            this.options,
          );
        },
        `approve-proposal-${proposalId}`,
      );

      const proposalIdStr = String(proposalId);
      const count = this.state.approvalCounts.get(proposalIdStr) ?? 0;
      this.state.approvalCounts.set(proposalIdStr, count + 1);
    } catch (error) {
      this.recordError("approve-proposal", String(error));
      throw error;
    }
  }

  /**
   * Execute all created proposals.
   * Retries failed executions up to maxAttempts.
   *
   * @param executorPublicKey Public key of executor
   * @returns Array of successfully executed proposal IDs
   */
  public async executeAllProposals(executorPublicKey: string): Promise<string[]> {
    const executedIds: string[] = [];

    for (const proposalId of this.state.createdProposalIds) {
      try {
        await this.retryOperation(
          async () => {
            await executeProposal(
              executorPublicKey,
              BigInt(proposalId),
              this.options,
            );
          },
          `execute-proposal-${proposalId}`,
        );

        executedIds.push(proposalId);
        this.state.executedProposalIds.push(proposalId);
      } catch (error) {
        this.recordError("execute-proposal", String(error));
      }
    }

    return executedIds;
  }

  /**
   * Execute a specific proposal.
   *
   * @param executorPublicKey Public key of executor
   * @param proposalId ID of proposal to execute (can be string or bigint)
   */
  public async executeProposal(
    executorPublicKey: string,
    proposalId: string | bigint,
  ): Promise<void> {
    try {
      await this.retryOperation(
        async () => {
          await executeProposal(
            executorPublicKey,
            typeof proposalId === "string" ? BigInt(proposalId) : proposalId,
            this.options,
          );
        },
        `execute-proposal-${proposalId}`,
      );

      const proposalIdStr = String(proposalId);
      this.state.executedProposalIds.push(proposalIdStr);
    } catch (error) {
      this.recordError("execute-proposal", String(error));
      throw error;
    }
  }

  /**
   * Execute the full orchestration: create → approve → execute.
   * Use individual methods for finer control.
   *
   * @param proposerPublicKey Public key of proposer
   * @param approverPublicKey Public key of approver (typically multi-sig)
   * @param executorPublicKey Public key of executor
   * @returns Orchestration result with counts and errors
   */
  public async executeFullOrchestration(
    proposerPublicKey: string,
    approverPublicKey: string,
    executorPublicKey: string,
  ): Promise<{
    created: number;
    approved: number;
    executed: number;
    failed: number;
    errors: ReadonlyArray<{ step: string; error: string }>;
  }> {
    // Step 1: Create all proposals
    const created = await this.createProposals(proposerPublicKey);

    // Step 2: Approve all proposals
    const approved = await this.approveAllProposals(approverPublicKey);

    // Step 3: Execute all proposals
    const executed = await this.executeAllProposals(executorPublicKey);

    // Calculate failures
    const failed = this.state.transfers.length - executed.length;

    return {
      created: created.length,
      approved,
      executed: executed.length,
      failed,
      errors: this.state.errors,
    };
  }

  /**
   * Reset orchestration state (clears transfers, proposals, errors).
   */
  public reset(): void {
    this.state = {
      transfers: [],
      createdProposalIds: [],
      approvalCounts: new Map(),
      executedProposalIds: [],
      errors: [],
    };
  }

  /**
   * Internal: Retry a single operation with exponential backoff.
   */
  private async retryOperation<T>(
    operation: () => Promise<T>,
    operationName: string,
  ): Promise<T> {
    let lastError: Error | undefined;
    let backoffMs = this.retryConfig.initialBackoffMs;

    for (let attempt = 1; attempt <= this.retryConfig.maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < this.retryConfig.maxAttempts) {
          // Wait before retrying
          await new Promise((resolve) => setTimeout(resolve, backoffMs));

          // Exponential backoff
          backoffMs = Math.min(
            backoffMs * 2,
            this.retryConfig.maxBackoffMs,
          );
        }
      }
    }

    throw lastError ?? new Error(`${operationName} failed after ${this.retryConfig.maxAttempts} attempts`);
  }

  /**
   * Internal: Record an error for diagnostics.
   */
  private recordError(step: string, error: string): void {
    this.state.errors.push({ step, error });
  }
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
export function createBatchOrchestrator(
  opts: SdkOptions,
  retryConfig?: Partial<RetryConfig>,
): BatchProposalOrchestrator {
  return new BatchProposalOrchestrator(opts, retryConfig);
}
