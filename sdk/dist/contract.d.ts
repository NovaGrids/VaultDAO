/**
 * VaultDAO SDK — Contract Bindings
 *
 * Low-level wrappers around every VaultDAO contract function.
 * Each function builds, simulates, and returns a signed-ready XDR string.
 * Use `signAndSubmit()` from utils.ts to broadcast the result.
 *
 * For read-only calls (getProposal, getRole, etc.) the function directly
 * decodes and returns the on-chain value without requiring a signature.
 */
import type { InitConfig, Proposal, SdkOptions, Comment, VaultMetrics, Reputation, AuditEntry } from "./types";
import { Role } from "./types";
/**
 * Build a transaction to initialise the VaultDAO contract (call once).
 *
 * @param adminPublicKey - Admin's Stellar public key.
 * @param config         - Vault configuration parameters.
 * @param opts           - SDK connection options.
 * @returns              Prepared transaction XDR ready for signing.
 */
export declare function initialize(adminPublicKey: string, config: InitConfig, opts: SdkOptions): Promise<string>;
/**
 * Build a transaction to propose a new token transfer from the vault.
 *
 * @param proposerPublicKey - Proposer's address (must be Treasurer or Admin).
 * @param recipient         - Destination address for the funds.
 * @param tokenAddress      - Contract ID of the token.
 * @param amount            - Amount in smallest unit (e.g., stroops for XLM).
 * @param memo              - Short memo/description (≤ 32 characters).
 * @param opts              - SDK connection options.
 * @returns                 Prepared transaction XDR.
 */
export declare function proposeTransfer(proposerPublicKey: string, recipient: string, tokenAddress: string, amount: bigint, memo: string, opts: SdkOptions): Promise<string>;
/**
 * Build a transaction for a signer to approve an existing proposal.
 *
 * @param signerPublicKey - Signer's address (must be in the signers list).
 * @param proposalId      - ID of the proposal to approve.
 * @param opts            - SDK connection options.
 */
export declare function approveProposal(signerPublicKey: string, proposalId: bigint, opts: SdkOptions): Promise<string>;
/**
 * Build a transaction to execute an approved (and unlocked) proposal.
 *
 * @param executorPublicKey - Address triggering execution.
 * @param proposalId        - ID of the proposal to execute.
 * @param opts              - SDK connection options.
 */
export declare function executeProposal(executorPublicKey: string, proposalId: bigint, opts: SdkOptions): Promise<string>;
/**
 * Build a transaction to reject a pending proposal.
 *
 * Only the original proposer or an Admin can reject.
 *
 * @param rejectorPublicKey - Address of the rejector.
 * @param proposalId        - ID of the proposal to reject.
 * @param opts              - SDK connection options.
 */
export declare function rejectProposal(rejectorPublicKey: string, proposalId: bigint, opts: SdkOptions): Promise<string>;
/**
 * Build a transaction to assign a role to an address.
 *
 * Only Admin can call this.
 *
 * @param adminPublicKey - Admin's address.
 * @param targetAddress  - Address to assign the role to.
 * @param role           - The `Role` to assign.
 * @param opts           - SDK connection options.
 */
export declare function setRole(adminPublicKey: string, targetAddress: string, role: Role, opts: SdkOptions): Promise<string>;
/**
 * Build a transaction to add a new signer to the vault.
 *
 * @param adminPublicKey  - Admin's address.
 * @param newSignerAddress - Address to add as a signer.
 * @param opts            - SDK connection options.
 */
export declare function addSigner(adminPublicKey: string, newSignerAddress: string, opts: SdkOptions): Promise<string>;
/**
 * Build a transaction to remove an existing signer.
 *
 * Will fail if removal would make the threshold unreachable.
 *
 * @param adminPublicKey   - Admin's address.
 * @param signerAddress    - Address to remove.
 * @param opts             - SDK connection options.
 */
export declare function removeSigner(adminPublicKey: string, signerAddress: string, opts: SdkOptions): Promise<string>;
/**
 * Build a transaction to update per-proposal and daily spending limits.
 *
 * @param adminPublicKey - Admin's address.
 * @param spendingLimit  - New per-proposal limit in stroops.
 * @param dailyLimit     - New daily aggregate limit in stroops.
 * @param opts           - SDK connection options.
 */
export declare function updateLimits(adminPublicKey: string, spendingLimit: bigint, dailyLimit: bigint, opts: SdkOptions): Promise<string>;
/**
 * Build a transaction to change the M-of-N approval threshold.
 *
 * @param adminPublicKey - Admin's address.
 * @param threshold      - New threshold value (1 ≤ threshold ≤ signers.length).
 * @param opts           - SDK connection options.
 */
export declare function updateThreshold(adminPublicKey: string, threshold: number, opts: SdkOptions): Promise<string>;
/**
 * Build a transaction to schedule a recurring payment.
 *
 * @param proposerPublicKey - Treasurer/Admin address.
 * @param recipient         - Destination address.
 * @param tokenAddress      - Token contract ID.
 * @param amount            - Per-execution amount in stroops.
 * @param memo              - Short memo string.
 * @param intervalLedgers   - Cadence in ledgers (min 720, ~1 hour).
 * @param opts              - SDK connection options.
 */
export declare function schedulePayment(proposerPublicKey: string, recipient: string, tokenAddress: string, amount: bigint, memo: string, intervalLedgers: bigint, opts: SdkOptions): Promise<string>;
/**
 * Build a transaction to execute a due recurring payment.
 *
 * Anyone (e.g., a keeper bot) can call this once the schedule is due.
 *
 * @param callerPublicKey - Caller's address (any Stellar account).
 * @param paymentId       - ID of the recurring payment schedule.
 * @param opts            - SDK connection options.
 */
export declare function executeRecurringPayment(callerPublicKey: string, paymentId: bigint, opts: SdkOptions): Promise<string>;
/**
 * Create a new streaming payment.
 */
export declare function createStream(senderPublicKey: string, recipient: string, token: string, totalAmount: bigint, flowRate: bigint, startLedger: bigint, endLedger: bigint, opts: SdkOptions): Promise<string>;
/**
 * Claim streamed funds.
 */
export declare function claimStream(recipientPublicKey: string, streamId: bigint, opts: SdkOptions): Promise<string>;
/**
 * Pause a streaming payment.
 */
export declare function pauseStream(senderPublicKey: string, streamId: bigint, opts: SdkOptions): Promise<string>;
/**
 * Cancel a streaming payment.
 */
export declare function cancelStream(senderPublicKey: string, streamId: bigint, opts: SdkOptions): Promise<string>;
/**
 * Create a new subscription.
 */
export declare function createSubscription(subscriberPublicKey: string, serviceProvider: string, tier: number, token: string, amountPerPeriod: bigint, intervalLedgers: bigint, opts: SdkOptions): Promise<string>;
/**
 * Renew a subscription.
 */
export declare function renewSubscription(subscriberPublicKey: string, subscriptionId: bigint, opts: SdkOptions): Promise<string>;
/**
 * Cancel a subscription.
 */
export declare function cancelSubscription(subscriberPublicKey: string, subscriptionId: bigint, opts: SdkOptions): Promise<string>;
/**
 * Create an escrow agreement.
 */
export declare function createEscrow(funderPublicKey: string, recipient: string, token: string, amount: bigint, arbitrator: string, durationLedgers: bigint, opts: SdkOptions): Promise<string>;
/**
 * Complete an escrow milestone.
 */
export declare function completeMilestone(recipientPublicKey: string, escrowId: bigint, opts: SdkOptions): Promise<string>;
/**
 * Release escrow funds.
 */
export declare function releaseEscrow(arbitratorPublicKey: string, escrowId: bigint, opts: SdkOptions): Promise<string>;
/**
 * Dispute an escrow agreement.
 */
export declare function disputeEscrow(partyPublicKey: string, escrowId: bigint, opts: SdkOptions): Promise<string>;
/**
 * Create a proposal template.
 */
export declare function createTemplate(creatorPublicKey: string, name: string, description: string, recipientTemplate: string, tokenTemplate: string, amountTemplate: bigint, opts: SdkOptions): Promise<string>;
/**
 * Propose a transfer from a template.
 */
export declare function proposeFromTemplate(proposerPublicKey: string, templateId: bigint, recipient: string, amount: bigint, opts: SdkOptions): Promise<string>;
/**
 * Deactivate a proposal template.
 */
export declare function deactivateTemplate(creatorPublicKey: string, templateId: bigint, opts: SdkOptions): Promise<string>;
/**
 * Add a comment to a proposal.
 */
export declare function addComment(authorPublicKey: string, proposalId: bigint, content: string, opts: SdkOptions): Promise<string>;
/**
 * Edit a comment.
 */
export declare function editComment(authorPublicKey: string, commentId: bigint, newContent: string, opts: SdkOptions): Promise<string>;
/**
 * Get comments for a proposal.
 */
export declare function getComments(proposalId: bigint, callerPublicKey: string, opts: SdkOptions): Promise<Comment[]>;
/**
 * Propose a recovery action.
 */
export declare function proposeRecovery(proposerPublicKey: string, recoveryType: string, opts: SdkOptions): Promise<string>;
/**
 * Approve a recovery proposal.
 */
export declare function approveRecovery(approverPublicKey: string, recoveryId: bigint, opts: SdkOptions): Promise<string>;
/**
 * Execute a recovery action.
 */
export declare function executeRecovery(executorPublicKey: string, recoveryId: bigint, opts: SdkOptions): Promise<string>;
/**
 * Get vault metrics.
 */
export declare function getVaultMetrics(callerPublicKey: string, opts: SdkOptions): Promise<VaultMetrics>;
/**
 * Get reputation for an address.
 */
export declare function getReputation(address: string, callerPublicKey: string, opts: SdkOptions): Promise<Reputation>;
/**
 * Get audit trail entries.
 */
export declare function getAuditTrail(callerPublicKey: string, opts: SdkOptions): Promise<AuditEntry[]>;
/**
 * Get delegation chain for an address.
 */
export declare function getDelegationChain(address: string, callerPublicKey: string, opts: SdkOptions): Promise<string[]>;
/**
 * Fetch a proposal by ID without submitting a transaction.
 *
 * @param proposalId      - ID of the proposal to fetch.
 * @param callerPublicKey - Any valid Stellar public key (used as simulation source).
 * @param opts            - SDK connection options.
 */
export declare function getProposal(proposalId: bigint, callerPublicKey: string, opts: SdkOptions): Promise<Proposal>;
/**
 * Get the `Role` for an address.
 *
 * @param address         - The address to query.
 * @param callerPublicKey - Any valid Stellar public key.
 * @param opts            - SDK connection options.
 */
export declare function getRole(address: string, callerPublicKey: string, opts: SdkOptions): Promise<Role>;
/**
 * Get today's aggregate spending (in stroops).
 *
 * @param callerPublicKey - Any valid Stellar public key.
 * @param opts            - SDK connection options.
 */
export declare function getTodaySpent(callerPublicKey: string, opts: SdkOptions): Promise<bigint>;
/**
 * Check whether an address is a registered signer.
 *
 * @param address         - Address to check.
 * @param callerPublicKey - Any valid Stellar public key.
 * @param opts            - SDK connection options.
 */
export declare function isSigner(address: string, callerPublicKey: string, opts: SdkOptions): Promise<boolean>;
//# sourceMappingURL=contract.d.ts.map