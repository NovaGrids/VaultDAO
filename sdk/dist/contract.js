"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.initialize = initialize;
exports.proposeTransfer = proposeTransfer;
exports.approveProposal = approveProposal;
exports.executeProposal = executeProposal;
exports.rejectProposal = rejectProposal;
exports.setRole = setRole;
exports.addSigner = addSigner;
exports.removeSigner = removeSigner;
exports.updateLimits = updateLimits;
exports.updateThreshold = updateThreshold;
exports.schedulePayment = schedulePayment;
exports.executeRecurringPayment = executeRecurringPayment;
exports.createStream = createStream;
exports.claimStream = claimStream;
exports.pauseStream = pauseStream;
exports.cancelStream = cancelStream;
exports.createSubscription = createSubscription;
exports.renewSubscription = renewSubscription;
exports.cancelSubscription = cancelSubscription;
exports.createEscrow = createEscrow;
exports.completeMilestone = completeMilestone;
exports.releaseEscrow = releaseEscrow;
exports.disputeEscrow = disputeEscrow;
exports.createTemplate = createTemplate;
exports.proposeFromTemplate = proposeFromTemplate;
exports.deactivateTemplate = deactivateTemplate;
exports.addComment = addComment;
exports.editComment = editComment;
exports.getComments = getComments;
exports.proposeRecovery = proposeRecovery;
exports.approveRecovery = approveRecovery;
exports.executeRecovery = executeRecovery;
exports.getVaultMetrics = getVaultMetrics;
exports.getReputation = getReputation;
exports.getAuditTrail = getAuditTrail;
exports.getDelegationChain = getDelegationChain;
exports.getProposal = getProposal;
exports.getRole = getRole;
exports.getTodaySpent = getTodaySpent;
exports.isSigner = isSigner;
const stellar_sdk_1 = require("stellar-sdk");
const types_1 = require("./types");
const utils_1 = require("./utils");
// ---------------------------------------------------------------------------
// Internal helper — simulate a read-only call and decode the return value
// ---------------------------------------------------------------------------
async function simulateReadOnly(operation, opts, sourceKey, method) {
    const log = opts.logger ?? types_1.noopLogger;
    const server = new stellar_sdk_1.SorobanRpc.Server(opts.rpcUrl, { allowHttp: false });
    const { Account, TransactionBuilder, BASE_FEE } = await Promise.resolve().then(() => __importStar(require("stellar-sdk")));
    const account = await server.getAccount(sourceKey);
    const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: opts.networkPassphrase,
    })
        .addOperation(operation)
        .setTimeout(15)
        .build();
    const ctx = { contractId: opts.contractId, method };
    const simStart = Date.now();
    log.debug("Simulating read-only call", ctx);
    const sim = await server.simulateTransaction(tx);
    if (stellar_sdk_1.SorobanRpc.Api.isSimulationError(sim)) {
        const durationMs = Date.now() - simStart;
        const err = (0, utils_1.parseError)(new Error(sim.error));
        log.error("Read-only simulation failed", {
            ...ctx,
            durationMs,
            errorMessage: err.message,
        });
        throw err;
    }
    if (!stellar_sdk_1.SorobanRpc.Api.isSimulationSuccess(sim) || !sim.result) {
        const durationMs = Date.now() - simStart;
        log.error("Read-only simulation returned no result", { ...ctx, durationMs });
        throw new Error("Simulation returned no result");
    }
    const durationMs = Date.now() - simStart;
    log.debug("Read-only call succeeded", { ...ctx, durationMs });
    return (0, utils_1.decodeScVal)(sim.result.retval);
}
// ---------------------------------------------------------------------------
// Internal helper — build a write transaction with logger instrumentation
// ---------------------------------------------------------------------------
/**
 * Wrap `buildTransaction` with before/after logger events for every
 * contract method invocation.
 *
 * @internal
 */
async function invokeMethod(method, callerPublicKey, operation, opts) {
    const log = opts.logger ?? types_1.noopLogger;
    const ctx = { contractId: opts.contractId, method };
    log.debug(`Invoking contract method: ${method}`, ctx);
    try {
        const txXdr = await (0, utils_1.buildTransaction)(callerPublicKey, operation, opts);
        log.debug(`Transaction built for method: ${method}`, ctx);
        return txXdr;
    }
    catch (err) {
        const parsed = err instanceof Error ? err : new Error(String(err));
        log.error(`Failed to build transaction for method: ${method}`, {
            ...ctx,
            errorMessage: parsed.message,
        });
        throw parsed;
    }
}
// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------
/**
 * Build a transaction to initialise the VaultDAO contract (call once).
 *
 * @param adminPublicKey - Admin's Stellar public key.
 * @param config         - Vault configuration parameters.
 * @param opts           - SDK connection options.
 * @returns              Prepared transaction XDR ready for signing.
 */
async function initialize(adminPublicKey, config, opts) {
    const contract = (0, utils_1.getContract)(opts);
    const signersScVal = stellar_sdk_1.xdr.ScVal.scvVec(config.signers.map((s) => (0, utils_1.addressToScVal)(s)));
    const configScVal = stellar_sdk_1.xdr.ScVal.scvMap([
        new stellar_sdk_1.xdr.ScMapEntry({
            key: stellar_sdk_1.xdr.ScVal.scvSymbol("signers"),
            val: signersScVal,
        }),
        new stellar_sdk_1.xdr.ScMapEntry({
            key: stellar_sdk_1.xdr.ScVal.scvSymbol("threshold"),
            val: (0, utils_1.u32ToScVal)(config.threshold),
        }),
        new stellar_sdk_1.xdr.ScMapEntry({
            key: stellar_sdk_1.xdr.ScVal.scvSymbol("spending_limit"),
            val: (0, utils_1.i128ToScVal)(config.spendingLimit),
        }),
        new stellar_sdk_1.xdr.ScMapEntry({
            key: stellar_sdk_1.xdr.ScVal.scvSymbol("daily_limit"),
            val: (0, utils_1.i128ToScVal)(config.dailyLimit),
        }),
        new stellar_sdk_1.xdr.ScMapEntry({
            key: stellar_sdk_1.xdr.ScVal.scvSymbol("weekly_limit"),
            val: (0, utils_1.i128ToScVal)(config.weeklyLimit),
        }),
        new stellar_sdk_1.xdr.ScMapEntry({
            key: stellar_sdk_1.xdr.ScVal.scvSymbol("timelock_threshold"),
            val: (0, utils_1.i128ToScVal)(config.timelockThreshold),
        }),
        new stellar_sdk_1.xdr.ScMapEntry({
            key: stellar_sdk_1.xdr.ScVal.scvSymbol("timelock_delay"),
            val: (0, utils_1.u64ToScVal)(config.timelockDelay),
        }),
    ]);
    const op = contract.call("initialize", (0, utils_1.addressToScVal)(adminPublicKey), configScVal);
    return invokeMethod("initialize", adminPublicKey, op, opts);
}
// ---------------------------------------------------------------------------
// Proposal Management
// ---------------------------------------------------------------------------
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
async function proposeTransfer(proposerPublicKey, recipient, tokenAddress, amount, memo, opts) {
    const contract = (0, utils_1.getContract)(opts);
    const op = contract.call("propose_transfer", (0, utils_1.addressToScVal)(proposerPublicKey), (0, utils_1.addressToScVal)(recipient), (0, utils_1.addressToScVal)(tokenAddress), (0, utils_1.i128ToScVal)(amount), (0, utils_1.symbolToScVal)(memo));
    return invokeMethod("propose_transfer", proposerPublicKey, op, opts);
}
/**
 * Build a transaction for a signer to approve an existing proposal.
 *
 * @param signerPublicKey - Signer's address (must be in the signers list).
 * @param proposalId      - ID of the proposal to approve.
 * @param opts            - SDK connection options.
 */
async function approveProposal(signerPublicKey, proposalId, opts) {
    const contract = (0, utils_1.getContract)(opts);
    const op = contract.call("approve_proposal", (0, utils_1.addressToScVal)(signerPublicKey), (0, utils_1.u64ToScVal)(proposalId));
    return invokeMethod("approve_proposal", signerPublicKey, op, opts);
}
/**
 * Build a transaction to execute an approved (and unlocked) proposal.
 *
 * @param executorPublicKey - Address triggering execution.
 * @param proposalId        - ID of the proposal to execute.
 * @param opts              - SDK connection options.
 */
async function executeProposal(executorPublicKey, proposalId, opts) {
    const contract = (0, utils_1.getContract)(opts);
    const op = contract.call("execute_proposal", (0, utils_1.addressToScVal)(executorPublicKey), (0, utils_1.u64ToScVal)(proposalId));
    return invokeMethod("execute_proposal", executorPublicKey, op, opts);
}
/**
 * Build a transaction to reject a pending proposal.
 *
 * Only the original proposer or an Admin can reject.
 *
 * @param rejectorPublicKey - Address of the rejector.
 * @param proposalId        - ID of the proposal to reject.
 * @param opts              - SDK connection options.
 */
async function rejectProposal(rejectorPublicKey, proposalId, opts) {
    const contract = (0, utils_1.getContract)(opts);
    const op = contract.call("reject_proposal", (0, utils_1.addressToScVal)(rejectorPublicKey), (0, utils_1.u64ToScVal)(proposalId));
    return (0, utils_1.buildTransaction)(rejectorPublicKey, op, opts);
}
// ---------------------------------------------------------------------------
// Admin Functions
// ---------------------------------------------------------------------------
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
async function setRole(adminPublicKey, targetAddress, role, opts) {
    const contract = (0, utils_1.getContract)(opts);
    const op = contract.call("set_role", (0, utils_1.addressToScVal)(adminPublicKey), (0, utils_1.addressToScVal)(targetAddress), (0, utils_1.u32ToScVal)(role));
    return (0, utils_1.buildTransaction)(adminPublicKey, op, opts);
}
/**
 * Build a transaction to add a new signer to the vault.
 *
 * @param adminPublicKey  - Admin's address.
 * @param newSignerAddress - Address to add as a signer.
 * @param opts            - SDK connection options.
 */
async function addSigner(adminPublicKey, newSignerAddress, opts) {
    const contract = (0, utils_1.getContract)(opts);
    const op = contract.call("add_signer", (0, utils_1.addressToScVal)(adminPublicKey), (0, utils_1.addressToScVal)(newSignerAddress));
    return (0, utils_1.buildTransaction)(adminPublicKey, op, opts);
}
/**
 * Build a transaction to remove an existing signer.
 *
 * Will fail if removal would make the threshold unreachable.
 *
 * @param adminPublicKey   - Admin's address.
 * @param signerAddress    - Address to remove.
 * @param opts             - SDK connection options.
 */
async function removeSigner(adminPublicKey, signerAddress, opts) {
    const contract = (0, utils_1.getContract)(opts);
    const op = contract.call("remove_signer", (0, utils_1.addressToScVal)(adminPublicKey), (0, utils_1.addressToScVal)(signerAddress));
    return (0, utils_1.buildTransaction)(adminPublicKey, op, opts);
}
/**
 * Build a transaction to update per-proposal and daily spending limits.
 *
 * @param adminPublicKey - Admin's address.
 * @param spendingLimit  - New per-proposal limit in stroops.
 * @param dailyLimit     - New daily aggregate limit in stroops.
 * @param opts           - SDK connection options.
 */
async function updateLimits(adminPublicKey, spendingLimit, dailyLimit, opts) {
    const contract = (0, utils_1.getContract)(opts);
    const op = contract.call("update_limits", (0, utils_1.addressToScVal)(adminPublicKey), (0, utils_1.i128ToScVal)(spendingLimit), (0, utils_1.i128ToScVal)(dailyLimit));
    return (0, utils_1.buildTransaction)(adminPublicKey, op, opts);
}
/**
 * Build a transaction to change the M-of-N approval threshold.
 *
 * @param adminPublicKey - Admin's address.
 * @param threshold      - New threshold value (1 ≤ threshold ≤ signers.length).
 * @param opts           - SDK connection options.
 */
async function updateThreshold(adminPublicKey, threshold, opts) {
    const contract = (0, utils_1.getContract)(opts);
    const op = contract.call("update_threshold", (0, utils_1.addressToScVal)(adminPublicKey), (0, utils_1.u32ToScVal)(threshold));
    return (0, utils_1.buildTransaction)(adminPublicKey, op, opts);
}
// ---------------------------------------------------------------------------
// Recurring Payments
// ---------------------------------------------------------------------------
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
async function schedulePayment(proposerPublicKey, recipient, tokenAddress, amount, memo, intervalLedgers, opts) {
    const contract = (0, utils_1.getContract)(opts);
    const op = contract.call("schedule_payment", (0, utils_1.addressToScVal)(proposerPublicKey), (0, utils_1.addressToScVal)(recipient), (0, utils_1.addressToScVal)(tokenAddress), (0, utils_1.i128ToScVal)(amount), (0, utils_1.symbolToScVal)(memo), (0, utils_1.u64ToScVal)(intervalLedgers));
    return (0, utils_1.buildTransaction)(proposerPublicKey, op, opts);
}
/**
 * Build a transaction to execute a due recurring payment.
 *
 * Anyone (e.g., a keeper bot) can call this once the schedule is due.
 *
 * @param callerPublicKey - Caller's address (any Stellar account).
 * @param paymentId       - ID of the recurring payment schedule.
 * @param opts            - SDK connection options.
 */
async function executeRecurringPayment(callerPublicKey, paymentId, opts) {
    const contract = (0, utils_1.getContract)(opts);
    const op = contract.call("execute_recurring_payment", (0, utils_1.u64ToScVal)(paymentId));
    return (0, utils_1.buildTransaction)(callerPublicKey, op, opts);
}
// ---------------------------------------------------------------------------
// Streaming Payments
// ---------------------------------------------------------------------------
/**
 * Create a new streaming payment.
 */
async function createStream(senderPublicKey, recipient, token, totalAmount, flowRate, startLedger, endLedger, opts) {
    const contract = (0, utils_1.getContract)(opts);
    const op = contract.call("create_stream", (0, utils_1.addressToScVal)(senderPublicKey), (0, utils_1.addressToScVal)(recipient), (0, utils_1.addressToScVal)(token), (0, utils_1.i128ToScVal)(totalAmount), (0, utils_1.i128ToScVal)(flowRate), (0, utils_1.u64ToScVal)(startLedger), (0, utils_1.u64ToScVal)(endLedger));
    return (0, utils_1.buildTransaction)(senderPublicKey, op, opts);
}
/**
 * Claim streamed funds.
 */
async function claimStream(recipientPublicKey, streamId, opts) {
    const contract = (0, utils_1.getContract)(opts);
    const op = contract.call("claim_stream", (0, utils_1.u64ToScVal)(streamId));
    return (0, utils_1.buildTransaction)(recipientPublicKey, op, opts);
}
/**
 * Pause a streaming payment.
 */
async function pauseStream(senderPublicKey, streamId, opts) {
    const contract = (0, utils_1.getContract)(opts);
    const op = contract.call("pause_stream", (0, utils_1.u64ToScVal)(streamId));
    return (0, utils_1.buildTransaction)(senderPublicKey, op, opts);
}
/**
 * Cancel a streaming payment.
 */
async function cancelStream(senderPublicKey, streamId, opts) {
    const contract = (0, utils_1.getContract)(opts);
    const op = contract.call("cancel_stream", (0, utils_1.u64ToScVal)(streamId));
    return (0, utils_1.buildTransaction)(senderPublicKey, op, opts);
}
// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------
/**
 * Create a new subscription.
 */
async function createSubscription(subscriberPublicKey, serviceProvider, tier, token, amountPerPeriod, intervalLedgers, opts) {
    const contract = (0, utils_1.getContract)(opts);
    const op = contract.call("create_subscription", (0, utils_1.addressToScVal)(subscriberPublicKey), (0, utils_1.addressToScVal)(serviceProvider), (0, utils_1.u32ToScVal)(tier), (0, utils_1.addressToScVal)(token), (0, utils_1.i128ToScVal)(amountPerPeriod), (0, utils_1.u64ToScVal)(intervalLedgers));
    return (0, utils_1.buildTransaction)(subscriberPublicKey, op, opts);
}
/**
 * Renew a subscription.
 */
async function renewSubscription(subscriberPublicKey, subscriptionId, opts) {
    const contract = (0, utils_1.getContract)(opts);
    const op = contract.call("renew_subscription", (0, utils_1.u64ToScVal)(subscriptionId));
    return (0, utils_1.buildTransaction)(subscriberPublicKey, op, opts);
}
/**
 * Cancel a subscription.
 */
async function cancelSubscription(subscriberPublicKey, subscriptionId, opts) {
    const contract = (0, utils_1.getContract)(opts);
    const op = contract.call("cancel_subscription", (0, utils_1.u64ToScVal)(subscriptionId));
    return (0, utils_1.buildTransaction)(subscriberPublicKey, op, opts);
}
// ---------------------------------------------------------------------------
// Escrow
// ---------------------------------------------------------------------------
/**
 * Create an escrow agreement.
 */
async function createEscrow(funderPublicKey, recipient, token, amount, arbitrator, durationLedgers, opts) {
    const contract = (0, utils_1.getContract)(opts);
    const op = contract.call("create_escrow", (0, utils_1.addressToScVal)(funderPublicKey), (0, utils_1.addressToScVal)(recipient), (0, utils_1.addressToScVal)(token), (0, utils_1.i128ToScVal)(amount), (0, utils_1.addressToScVal)(arbitrator), (0, utils_1.u64ToScVal)(durationLedgers));
    return (0, utils_1.buildTransaction)(funderPublicKey, op, opts);
}
/**
 * Complete an escrow milestone.
 */
async function completeMilestone(recipientPublicKey, escrowId, opts) {
    const contract = (0, utils_1.getContract)(opts);
    const op = contract.call("complete_milestone", (0, utils_1.u64ToScVal)(escrowId));
    return (0, utils_1.buildTransaction)(recipientPublicKey, op, opts);
}
/**
 * Release escrow funds.
 */
async function releaseEscrow(arbitratorPublicKey, escrowId, opts) {
    const contract = (0, utils_1.getContract)(opts);
    const op = contract.call("release_escrow", (0, utils_1.u64ToScVal)(escrowId));
    return (0, utils_1.buildTransaction)(arbitratorPublicKey, op, opts);
}
/**
 * Dispute an escrow agreement.
 */
async function disputeEscrow(partyPublicKey, escrowId, opts) {
    const contract = (0, utils_1.getContract)(opts);
    const op = contract.call("dispute_escrow", (0, utils_1.u64ToScVal)(escrowId));
    return (0, utils_1.buildTransaction)(partyPublicKey, op, opts);
}
// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------
/**
 * Create a proposal template.
 */
async function createTemplate(creatorPublicKey, name, description, recipientTemplate, tokenTemplate, amountTemplate, opts) {
    const contract = (0, utils_1.getContract)(opts);
    const op = contract.call("create_template", (0, utils_1.addressToScVal)(creatorPublicKey), stellar_sdk_1.xdr.ScVal.scvString(name), stellar_sdk_1.xdr.ScVal.scvString(description), stellar_sdk_1.xdr.ScVal.scvString(recipientTemplate), stellar_sdk_1.xdr.ScVal.scvString(tokenTemplate), (0, utils_1.i128ToScVal)(amountTemplate));
    return (0, utils_1.buildTransaction)(creatorPublicKey, op, opts);
}
/**
 * Propose a transfer from a template.
 */
async function proposeFromTemplate(proposerPublicKey, templateId, recipient, amount, opts) {
    const contract = (0, utils_1.getContract)(opts);
    const op = contract.call("propose_from_template", (0, utils_1.u64ToScVal)(templateId), (0, utils_1.addressToScVal)(recipient), (0, utils_1.i128ToScVal)(amount));
    return (0, utils_1.buildTransaction)(proposerPublicKey, op, opts);
}
/**
 * Deactivate a proposal template.
 */
async function deactivateTemplate(creatorPublicKey, templateId, opts) {
    const contract = (0, utils_1.getContract)(opts);
    const op = contract.call("deactivate_template", (0, utils_1.u64ToScVal)(templateId));
    return (0, utils_1.buildTransaction)(creatorPublicKey, op, opts);
}
// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------
/**
 * Add a comment to a proposal.
 */
async function addComment(authorPublicKey, proposalId, content, opts) {
    const contract = (0, utils_1.getContract)(opts);
    const op = contract.call("add_comment", (0, utils_1.u64ToScVal)(proposalId), stellar_sdk_1.xdr.ScVal.scvString(content));
    return (0, utils_1.buildTransaction)(authorPublicKey, op, opts);
}
/**
 * Edit a comment.
 */
async function editComment(authorPublicKey, commentId, newContent, opts) {
    const contract = (0, utils_1.getContract)(opts);
    const op = contract.call("edit_comment", (0, utils_1.u64ToScVal)(commentId), stellar_sdk_1.xdr.ScVal.scvString(newContent));
    return (0, utils_1.buildTransaction)(authorPublicKey, op, opts);
}
/**
 * Get comments for a proposal.
 */
async function getComments(proposalId, callerPublicKey, opts) {
    const contract = (0, utils_1.getContract)(opts);
    const op = contract.call("get_comments", (0, utils_1.u64ToScVal)(proposalId));
    const raw = await simulateReadOnly(op, opts, callerPublicKey, "getComments");
    return raw.map((c) => ({
        id: BigInt(c.id),
        proposalId: BigInt(c.proposal_id),
        author: c.author,
        content: c.content,
        createdAt: BigInt(c.created_at),
    }));
}
// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------
/**
 * Propose a recovery action.
 */
async function proposeRecovery(proposerPublicKey, recoveryType, opts) {
    const contract = (0, utils_1.getContract)(opts);
    const op = contract.call("propose_recovery", stellar_sdk_1.xdr.ScVal.scvString(recoveryType));
    return (0, utils_1.buildTransaction)(proposerPublicKey, op, opts);
}
/**
 * Approve a recovery proposal.
 */
async function approveRecovery(approverPublicKey, recoveryId, opts) {
    const contract = (0, utils_1.getContract)(opts);
    const op = contract.call("approve_recovery", (0, utils_1.u64ToScVal)(recoveryId));
    return (0, utils_1.buildTransaction)(approverPublicKey, op, opts);
}
/**
 * Execute a recovery action.
 */
async function executeRecovery(executorPublicKey, recoveryId, opts) {
    const contract = (0, utils_1.getContract)(opts);
    const op = contract.call("execute_recovery", (0, utils_1.u64ToScVal)(recoveryId));
    return (0, utils_1.buildTransaction)(executorPublicKey, op, opts);
}
// ---------------------------------------------------------------------------
// Read Functions
// ---------------------------------------------------------------------------
/**
 * Get vault metrics.
 */
async function getVaultMetrics(callerPublicKey, opts) {
    const contract = (0, utils_1.getContract)(opts);
    const op = contract.call("get_vault_metrics");
    const raw = await simulateReadOnly(op, opts, callerPublicKey, "getVaultMetrics");
    return {
        executedCount: BigInt(raw.executed_count),
        rejectedCount: BigInt(raw.rejected_count),
        expiredCount: BigInt(raw.expired_count),
        totalVolume: BigInt(raw.total_volume),
    };
}
/**
 * Get reputation for an address.
 */
async function getReputation(address, callerPublicKey, opts) {
    const contract = (0, utils_1.getContract)(opts);
    const op = contract.call("get_reputation", (0, utils_1.addressToScVal)(address));
    const raw = await simulateReadOnly(op, opts, callerPublicKey, "getReputation");
    return {
        address: raw.address,
        score: BigInt(raw.score),
        proposalsCreated: BigInt(raw.proposals_created),
        proposalsApproved: BigInt(raw.proposals_approved),
        lastUpdated: BigInt(raw.last_updated),
    };
}
/**
 * Get audit trail entries.
 */
async function getAuditTrail(callerPublicKey, opts) {
    const contract = (0, utils_1.getContract)(opts);
    const op = contract.call("get_audit_trail");
    const raw = await simulateReadOnly(op, opts, callerPublicKey, "getAuditTrail");
    return raw.map((e) => ({
        id: BigInt(e.id),
        action: e.action,
        actor: e.actor,
        proposalId: BigInt(e.proposal_id),
        timestamp: BigInt(e.timestamp),
    }));
}
/**
 * Get delegation chain for an address.
 */
async function getDelegationChain(address, callerPublicKey, opts) {
    const contract = (0, utils_1.getContract)(opts);
    const op = contract.call("get_delegation_chain", (0, utils_1.addressToScVal)(address));
    return simulateReadOnly(op, opts, callerPublicKey, "getDelegationChain");
}
// ---------------------------------------------------------------------------
// View / Read-only Functions
// ---------------------------------------------------------------------------
/**
 * Fetch a proposal by ID without submitting a transaction.
 *
 * @param proposalId      - ID of the proposal to fetch.
 * @param callerPublicKey - Any valid Stellar public key (used as simulation source).
 * @param opts            - SDK connection options.
 */
async function getProposal(proposalId, callerPublicKey, opts) {
    const contract = (0, utils_1.getContract)(opts);
    const op = contract.call("get_proposal", (0, utils_1.u64ToScVal)(proposalId));
    const raw = await simulateReadOnly(op, opts, callerPublicKey, "getProposal");
    return decodeProposal(raw);
}
/**
 * Get the `Role` for an address.
 *
 * @param address         - The address to query.
 * @param callerPublicKey - Any valid Stellar public key.
 * @param opts            - SDK connection options.
 */
async function getRole(address, callerPublicKey, opts) {
    const contract = (0, utils_1.getContract)(opts);
    const op = contract.call("get_role", (0, utils_1.addressToScVal)(address));
    const raw = await simulateReadOnly(op, opts, callerPublicKey, "getRole");
    return raw;
}
/**
 * Get today's aggregate spending (in stroops).
 *
 * @param callerPublicKey - Any valid Stellar public key.
 * @param opts            - SDK connection options.
 */
async function getTodaySpent(callerPublicKey, opts) {
    const contract = (0, utils_1.getContract)(opts);
    const op = contract.call("get_today_spent");
    return simulateReadOnly(op, opts, callerPublicKey, "getTodaySpent");
}
/**
 * Check whether an address is a registered signer.
 *
 * @param address         - Address to check.
 * @param callerPublicKey - Any valid Stellar public key.
 * @param opts            - SDK connection options.
 */
async function isSigner(address, callerPublicKey, opts) {
    const contract = (0, utils_1.getContract)(opts);
    const op = contract.call("is_signer", (0, utils_1.addressToScVal)(address));
    return simulateReadOnly(op, opts, callerPublicKey, "isSigner");
}
// ---------------------------------------------------------------------------
// Decoding helpers
// ---------------------------------------------------------------------------
function decodeProposal(raw) {
    return {
        id: BigInt(raw.id),
        proposer: raw.proposer,
        recipient: raw.recipient,
        token: raw.token,
        amount: BigInt(raw.amount),
        memo: raw.memo,
        approvals: raw.approvals,
        status: raw.status,
        createdAt: BigInt(raw.created_at),
        expiresAt: BigInt(raw.expires_at),
        unlockLedger: BigInt(raw.unlock_ledger),
    };
}
//# sourceMappingURL=contract.js.map