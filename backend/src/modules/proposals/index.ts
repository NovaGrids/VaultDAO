/**
 * Proposal Activity Indexing Module
 * 
 * This module provides proposal lifecycle event indexing for the VaultDAO system.
 * It is designed to be modular and not tightly coupled to HTTP routes,
 * making it suitable for future storage integration.
 * 
 * @example
 * ```typescript
 * import { 
 *   createProposalConsumer,
 *   createProposalAggregator,
 *   createMemoryPersistence 
 * } from './modules/proposals';
 * 
 * // Create and configure components
 * const consumer = createProposalConsumer({ batchSize: 50 });
 * const aggregator = createProposalAggregator();
 * const persistence = createMemoryPersistence();
 * 
 * // Connect them together
 * consumer.setPersistence(persistence);
 * consumer.registerConsumer((record) => {
 *   aggregator.addRecord(record);
 * });
 * 
 * // Start consuming events
 * consumer.start();
 * ```
 */

// Types
export * from "./types.js";

// Core components
export { ProposalActivityConsumer, createProposalConsumer } from "./consumer.js";
export { ProposalActivityAggregator, createProposalAggregator } from "./aggregator.js";
export type {
  ProposalActivityStats,
  ActivityBucket,
  GetAllProposalsParams,
  GetAllProposalsResult,
} from "./aggregator.js";
export { GET_ALL_PROPOSALS_MAX_LIMIT } from "./aggregator.js";

// Transforms
export { ProposalEventTransformer, transformEventBatch, isProposalEvent } from "./transforms.js";

// Adapters (persistence hooks)
export { MemoryProposalPersistence, createMemoryPersistence } from "./adapters/index.js";
