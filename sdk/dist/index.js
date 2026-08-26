"use strict";
/**
 * VaultDAO SDK — Public API
 *
 * Import everything you need from this single entry point.
 *
 * @example
 * import { proposeTransfer, signAndSubmit, buildOptions } from "@vaultdao/sdk";
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.proposeFromTemplate = exports.createTemplate = exports.disputeEscrow = exports.releaseEscrow = exports.completeMilestone = exports.createEscrow = exports.cancelSubscription = exports.renewSubscription = exports.createSubscription = exports.cancelStream = exports.pauseStream = exports.claimStream = exports.createStream = exports.executeRecurringPayment = exports.schedulePayment = exports.updateThreshold = exports.updateLimits = exports.removeSigner = exports.addSigner = exports.setRole = exports.rejectProposal = exports.executeProposal = exports.approveProposal = exports.proposeTransfer = exports.initialize = exports.decodeScVal = exports.symbolToScVal = exports.u32ToScVal = exports.u64ToScVal = exports.i128ToScVal = exports.addressToScVal = exports.DEFAULT_RPC_URLS = exports.NETWORK_PASSPHRASES = exports.parseError = exports.simulate_with_state_diff = exports.simulateWithStateDiff = exports.extractStateDiff = exports.signAndSubmit = exports.buildTransaction = exports.connectWallet = exports.buildOptions = exports.getAllErrorEntries = exports.getErrorDescription = exports.getErrorEntry = exports.DEFAULT_ERROR_REGISTRY = exports.ERROR_REGISTRY = exports.VaultError = exports.VaultErrorCode = exports.ProposalStatus = exports.Role = void 0;
exports.destroyGlobalCache = exports.getGlobalCache = exports.ContractCache = exports.MockVaultContract = exports.BatchProposalOrchestrator = exports.createBatchOrchestrator = exports.isSigner = exports.getTodaySpent = exports.getRole = exports.getProposal = exports.getDelegationChain = exports.getAuditTrail = exports.getReputation = exports.getVaultMetrics = exports.executeRecovery = exports.approveRecovery = exports.proposeRecovery = exports.getComments = exports.editComment = exports.addComment = exports.deactivateTemplate = void 0;
// Enums & errors
var types_1 = require("./types");
Object.defineProperty(exports, "Role", { enumerable: true, get: function () { return types_1.Role; } });
Object.defineProperty(exports, "ProposalStatus", { enumerable: true, get: function () { return types_1.ProposalStatus; } });
Object.defineProperty(exports, "VaultErrorCode", { enumerable: true, get: function () { return types_1.VaultErrorCode; } });
Object.defineProperty(exports, "VaultError", { enumerable: true, get: function () { return types_1.VaultError; } });
var errors_1 = require("./errors");
Object.defineProperty(exports, "ERROR_REGISTRY", { enumerable: true, get: function () { return errors_1.ERROR_REGISTRY; } });
Object.defineProperty(exports, "DEFAULT_ERROR_REGISTRY", { enumerable: true, get: function () { return errors_1.ERROR_REGISTRY; } });
Object.defineProperty(exports, "getErrorEntry", { enumerable: true, get: function () { return errors_1.getErrorEntry; } });
Object.defineProperty(exports, "getErrorDescription", { enumerable: true, get: function () { return errors_1.getErrorDescription; } });
Object.defineProperty(exports, "getAllErrorEntries", { enumerable: true, get: function () { return errors_1.getAllErrorEntries; } });
var utils_1 = require("./utils");
Object.defineProperty(exports, "buildOptions", { enumerable: true, get: function () { return utils_1.buildOptions; } });
Object.defineProperty(exports, "connectWallet", { enumerable: true, get: function () { return utils_1.connectWallet; } });
Object.defineProperty(exports, "buildTransaction", { enumerable: true, get: function () { return utils_1.buildTransaction; } });
Object.defineProperty(exports, "signAndSubmit", { enumerable: true, get: function () { return utils_1.signAndSubmit; } });
Object.defineProperty(exports, "extractStateDiff", { enumerable: true, get: function () { return utils_1.extractStateDiff; } });
Object.defineProperty(exports, "simulateWithStateDiff", { enumerable: true, get: function () { return utils_1.simulateWithStateDiff; } });
Object.defineProperty(exports, "simulate_with_state_diff", { enumerable: true, get: function () { return utils_1.simulate_with_state_diff; } });
Object.defineProperty(exports, "parseError", { enumerable: true, get: function () { return utils_1.parseError; } });
Object.defineProperty(exports, "NETWORK_PASSPHRASES", { enumerable: true, get: function () { return utils_1.NETWORK_PASSPHRASES; } });
Object.defineProperty(exports, "DEFAULT_RPC_URLS", { enumerable: true, get: function () { return utils_1.DEFAULT_RPC_URLS; } });
// ScVal converters — useful for advanced use cases
Object.defineProperty(exports, "addressToScVal", { enumerable: true, get: function () { return utils_1.addressToScVal; } });
Object.defineProperty(exports, "i128ToScVal", { enumerable: true, get: function () { return utils_1.i128ToScVal; } });
Object.defineProperty(exports, "u64ToScVal", { enumerable: true, get: function () { return utils_1.u64ToScVal; } });
Object.defineProperty(exports, "u32ToScVal", { enumerable: true, get: function () { return utils_1.u32ToScVal; } });
Object.defineProperty(exports, "symbolToScVal", { enumerable: true, get: function () { return utils_1.symbolToScVal; } });
Object.defineProperty(exports, "decodeScVal", { enumerable: true, get: function () { return utils_1.decodeScVal; } });
// Contract bindings
var contract_1 = require("./contract");
// Initialization
Object.defineProperty(exports, "initialize", { enumerable: true, get: function () { return contract_1.initialize; } });
// Proposal lifecycle
Object.defineProperty(exports, "proposeTransfer", { enumerable: true, get: function () { return contract_1.proposeTransfer; } });
Object.defineProperty(exports, "approveProposal", { enumerable: true, get: function () { return contract_1.approveProposal; } });
Object.defineProperty(exports, "executeProposal", { enumerable: true, get: function () { return contract_1.executeProposal; } });
Object.defineProperty(exports, "rejectProposal", { enumerable: true, get: function () { return contract_1.rejectProposal; } });
// Admin
Object.defineProperty(exports, "setRole", { enumerable: true, get: function () { return contract_1.setRole; } });
Object.defineProperty(exports, "addSigner", { enumerable: true, get: function () { return contract_1.addSigner; } });
Object.defineProperty(exports, "removeSigner", { enumerable: true, get: function () { return contract_1.removeSigner; } });
Object.defineProperty(exports, "updateLimits", { enumerable: true, get: function () { return contract_1.updateLimits; } });
Object.defineProperty(exports, "updateThreshold", { enumerable: true, get: function () { return contract_1.updateThreshold; } });
// Recurring payments
Object.defineProperty(exports, "schedulePayment", { enumerable: true, get: function () { return contract_1.schedulePayment; } });
Object.defineProperty(exports, "executeRecurringPayment", { enumerable: true, get: function () { return contract_1.executeRecurringPayment; } });
// Streaming payments
Object.defineProperty(exports, "createStream", { enumerable: true, get: function () { return contract_1.createStream; } });
Object.defineProperty(exports, "claimStream", { enumerable: true, get: function () { return contract_1.claimStream; } });
Object.defineProperty(exports, "pauseStream", { enumerable: true, get: function () { return contract_1.pauseStream; } });
Object.defineProperty(exports, "cancelStream", { enumerable: true, get: function () { return contract_1.cancelStream; } });
// Subscriptions
Object.defineProperty(exports, "createSubscription", { enumerable: true, get: function () { return contract_1.createSubscription; } });
Object.defineProperty(exports, "renewSubscription", { enumerable: true, get: function () { return contract_1.renewSubscription; } });
Object.defineProperty(exports, "cancelSubscription", { enumerable: true, get: function () { return contract_1.cancelSubscription; } });
// Escrow
Object.defineProperty(exports, "createEscrow", { enumerable: true, get: function () { return contract_1.createEscrow; } });
Object.defineProperty(exports, "completeMilestone", { enumerable: true, get: function () { return contract_1.completeMilestone; } });
Object.defineProperty(exports, "releaseEscrow", { enumerable: true, get: function () { return contract_1.releaseEscrow; } });
Object.defineProperty(exports, "disputeEscrow", { enumerable: true, get: function () { return contract_1.disputeEscrow; } });
// Templates
Object.defineProperty(exports, "createTemplate", { enumerable: true, get: function () { return contract_1.createTemplate; } });
Object.defineProperty(exports, "proposeFromTemplate", { enumerable: true, get: function () { return contract_1.proposeFromTemplate; } });
Object.defineProperty(exports, "deactivateTemplate", { enumerable: true, get: function () { return contract_1.deactivateTemplate; } });
// Comments
Object.defineProperty(exports, "addComment", { enumerable: true, get: function () { return contract_1.addComment; } });
Object.defineProperty(exports, "editComment", { enumerable: true, get: function () { return contract_1.editComment; } });
Object.defineProperty(exports, "getComments", { enumerable: true, get: function () { return contract_1.getComments; } });
// Recovery
Object.defineProperty(exports, "proposeRecovery", { enumerable: true, get: function () { return contract_1.proposeRecovery; } });
Object.defineProperty(exports, "approveRecovery", { enumerable: true, get: function () { return contract_1.approveRecovery; } });
Object.defineProperty(exports, "executeRecovery", { enumerable: true, get: function () { return contract_1.executeRecovery; } });
// Read functions
Object.defineProperty(exports, "getVaultMetrics", { enumerable: true, get: function () { return contract_1.getVaultMetrics; } });
Object.defineProperty(exports, "getReputation", { enumerable: true, get: function () { return contract_1.getReputation; } });
Object.defineProperty(exports, "getAuditTrail", { enumerable: true, get: function () { return contract_1.getAuditTrail; } });
Object.defineProperty(exports, "getDelegationChain", { enumerable: true, get: function () { return contract_1.getDelegationChain; } });
// View / read-only
Object.defineProperty(exports, "getProposal", { enumerable: true, get: function () { return contract_1.getProposal; } });
Object.defineProperty(exports, "getRole", { enumerable: true, get: function () { return contract_1.getRole; } });
Object.defineProperty(exports, "getTodaySpent", { enumerable: true, get: function () { return contract_1.getTodaySpent; } });
Object.defineProperty(exports, "isSigner", { enumerable: true, get: function () { return contract_1.isSigner; } });
// Batch orchestration
var batch_orchestrator_1 = require("./batch-orchestrator");
Object.defineProperty(exports, "createBatchOrchestrator", { enumerable: true, get: function () { return batch_orchestrator_1.createBatchOrchestrator; } });
Object.defineProperty(exports, "BatchProposalOrchestrator", { enumerable: true, get: function () { return batch_orchestrator_1.BatchProposalOrchestrator; } });
// Testing utilities
var mock_contract_1 = require("./mock-contract");
Object.defineProperty(exports, "MockVaultContract", { enumerable: true, get: function () { return mock_contract_1.MockVaultContract; } });
// Caching layer
var cache_1 = require("./cache");
Object.defineProperty(exports, "ContractCache", { enumerable: true, get: function () { return cache_1.ContractCache; } });
Object.defineProperty(exports, "getGlobalCache", { enumerable: true, get: function () { return cache_1.getGlobalCache; } });
Object.defineProperty(exports, "destroyGlobalCache", { enumerable: true, get: function () { return cache_1.destroyGlobalCache; } });
//# sourceMappingURL=index.js.map