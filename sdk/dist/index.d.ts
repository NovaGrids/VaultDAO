/**
 * VaultDAO SDK — Public API
 *
 * Import everything you need from this single entry point.
 *
 * @example
 * import { proposeTransfer, signAndSubmit, buildOptions } from "@vaultdao/sdk";
 */
export type { InitConfig, VaultConfig, Proposal, RecurringPayment, StreamingPayment, Subscription, Escrow, ProposalTemplate, Comment, VaultMetrics, Reputation, AuditEntry, SdkOptions, SdkLogger, Network, StateDiff, StateChangeValue, StateChangeEntry, } from "./types";
export { Role, ProposalStatus, VaultErrorCode, VaultError } from "./types";
export type { ErrorRegistryEntry } from "./errors";
export { ERROR_REGISTRY, ERROR_REGISTRY as DEFAULT_ERROR_REGISTRY, getErrorEntry, getErrorDescription, getAllErrorEntries, } from "./errors";
export type { WalletConnection } from "./utils";
export { buildOptions, connectWallet, buildTransaction, signAndSubmit, extractStateDiff, simulateWithStateDiff, simulate_with_state_diff, parseError, NETWORK_PASSPHRASES, DEFAULT_RPC_URLS, addressToScVal, i128ToScVal, u64ToScVal, u32ToScVal, symbolToScVal, decodeScVal, } from "./utils";
export { initialize, proposeTransfer, approveProposal, executeProposal, rejectProposal, setRole, addSigner, removeSigner, updateLimits, updateThreshold, schedulePayment, executeRecurringPayment, createStream, claimStream, pauseStream, cancelStream, createSubscription, renewSubscription, cancelSubscription, createEscrow, completeMilestone, releaseEscrow, disputeEscrow, createTemplate, proposeFromTemplate, deactivateTemplate, addComment, editComment, getComments, proposeRecovery, approveRecovery, executeRecovery, getVaultMetrics, getReputation, getAuditTrail, getDelegationChain, getProposal, getRole, getTodaySpent, isSigner, } from "./contract";
export { createBatchOrchestrator, BatchProposalOrchestrator, } from "./batch-orchestrator";
export type { BatchTransfer, RetryConfig, } from "./batch-orchestrator";
export { MockVaultContract } from "./mock-contract";
export type { FailureInjectionConfig } from "./mock-contract";
export { ContractCache, getGlobalCache, destroyGlobalCache, } from "./cache";
export type { CacheEntry, CacheStats, CacheMetrics, } from "./cache";
//# sourceMappingURL=index.d.ts.map