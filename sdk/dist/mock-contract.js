"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockVaultContract = void 0;
const types_1 = require("./types");
const utils_1 = require("./utils");
// ---------------------------------------------------------------------------
// Mock Contract Implementation
// ---------------------------------------------------------------------------
class MockVaultContract {
    constructor(logger) {
        this.isInitialized = false;
        this.config = null;
        this.roles = new Map();
        this.proposals = new Map();
        this.recurringPayments = new Map();
        this.streamingPayments = new Map();
        this.subscriptions = new Map();
        this.escrows = new Map();
        this.templates = new Map();
        this.comments = new Map();
        this.metrics = null;
        // Counter for auto-incrementing IDs
        this.proposalIdCounter = 1n;
        this.recurringIdCounter = 1n;
        this.streamIdCounter = 1n;
        this.subscriptionIdCounter = 1n;
        this.escrowIdCounter = 1n;
        this.templateIdCounter = 1n;
        this.commentIdCounter = 1n;
        // Time/ledger controls for testing
        this.currentLedger = 0n;
        this.currentTime = BigInt(Date.now());
        // Failure injection
        this.failureInjections = new Map();
        this.logger = logger ?? types_1.noopLogger;
    }
    // ─────────────────────────────────────────────────────────────────────────
    // Control Interface
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * Advance the mock ledger by N sequences (~5s per ledger).
     */
    advanceLedger(count) {
        const n = typeof count === "number" ? BigInt(count) : count;
        this.currentLedger += n;
        this.logger.debug("Mock ledger advanced", { newLedger: this.currentLedger });
    }
    /**
     * Advance the mock time (internal clock) by milliseconds.
     */
    advanceTime(ms) {
        const delta = typeof ms === "number" ? BigInt(ms) : ms;
        this.currentTime += delta;
        this.logger.debug("Mock time advanced", { newTime: this.currentTime });
    }
    /**
     * Set the current ledger sequence.
     */
    setLedger(ledger) {
        this.currentLedger = typeof ledger === "number" ? BigInt(ledger) : ledger;
        this.logger.debug("Mock ledger set", { ledger: this.currentLedger });
    }
    /**
     * Set the current time (milliseconds since epoch).
     */
    setTime(ms) {
        this.currentTime = typeof ms === "number" ? BigInt(ms) : ms;
        this.logger.debug("Mock time set", { time: this.currentTime });
    }
    /**
     * Inject a deterministic failure for a specific method.
     * The next invocation of that method will throw the specified error.
     */
    injectFailure(method, errorCode, message) {
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
    clearFailures() {
        this.failureInjections.clear();
        this.logger.debug("All failure injections cleared");
    }
    /**
     * Get current mock state (for assertions in tests).
     */
    getState() {
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
    checkFailure(methodName) {
        const failure = this.failureInjections.get(methodName);
        if (failure) {
            this.failureInjections.delete(methodName);
            this.logger.warn("Injected failure triggered", {
                method: methodName,
                errorCode: failure.errorCode,
            });
            throw new types_1.VaultError(failure.errorCode, failure.message);
        }
    }
    /**
     * Initialize the vault (once).
     */
    initialize(adminPublicKey, config) {
        this.checkFailure("initialize");
        if (this.isInitialized) {
            throw new types_1.VaultError(types_1.VaultErrorCode.AlreadyInitialized, "Vault already initialized");
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
        this.roles.set(adminPublicKey, types_1.Role.Admin);
        this.isInitialized = true;
        this.logger.info("Mock vault initialized", { adminPublicKey });
    }
    /**
     * Get vault configuration.
     */
    getConfig() {
        this.checkFailure("getConfig");
        if (!this.config) {
            throw new types_1.VaultError(types_1.VaultErrorCode.NotInitialized, "Vault not initialized");
        }
        return { ...this.config };
    }
    /**
     * Get a proposal by ID.
     */
    getProposal(id) {
        this.checkFailure("getProposal");
        const proposal = this.proposals.get(id);
        if (!proposal) {
            throw new types_1.VaultError(types_1.VaultErrorCode.ProposalNotFound, `Proposal ${id} not found`);
        }
        const { approvalCount, ...rest } = proposal;
        return rest;
    }
    /**
     * Get caller's role.
     */
    getRole(callerPublicKey) {
        this.checkFailure("getRole");
        const role = this.roles.get(callerPublicKey);
        if (role === undefined) {
            return types_1.Role.Member; // Default to Member if no role assigned
        }
        return role;
    }
    /**
     * Propose a transfer.
     */
    proposeTransfer(proposerPublicKey, recipient, token, amount, memo) {
        this.checkFailure("proposeTransfer");
        if (!this.config) {
            throw new types_1.VaultError(types_1.VaultErrorCode.NotInitialized, "Vault not initialized");
        }
        const role = this.getRole(proposerPublicKey);
        if (role !== types_1.Role.Treasurer && role !== types_1.Role.Admin) {
            throw new types_1.VaultError(types_1.VaultErrorCode.InsufficientRole, "Only treasurers can propose transfers");
        }
        if (amount > this.config.spendingLimit) {
            throw new types_1.VaultError(types_1.VaultErrorCode.ExceedsProposalLimit, "Amount exceeds spending limit");
        }
        const id = this.proposalIdCounter++;
        const createdAt = this.currentLedger;
        const expiresAt = this.currentLedger + 30240n; // ~7 days
        const proposal = {
            id,
            proposer: proposerPublicKey,
            recipient,
            token,
            amount,
            memo,
            approvals: [proposerPublicKey],
            status: types_1.ProposalStatus.Pending,
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
    approveProposal(approverPublicKey, proposalId) {
        this.checkFailure("approveProposal");
        if (!this.config) {
            throw new types_1.VaultError(types_1.VaultErrorCode.NotInitialized, "Vault not initialized");
        }
        const proposal = this.proposals.get(proposalId);
        if (!proposal) {
            throw new types_1.VaultError(types_1.VaultErrorCode.ProposalNotFound, `Proposal ${proposalId} not found`);
        }
        const role = this.getRole(approverPublicKey);
        if (role !== types_1.Role.Treasurer && role !== types_1.Role.Admin) {
            throw new types_1.VaultError(types_1.VaultErrorCode.InsufficientRole, "Only treasurers can approve");
        }
        if (proposal.approvals.includes(approverPublicKey)) {
            throw new types_1.VaultError(types_1.VaultErrorCode.AlreadyApproved, "Already approved by this signer");
        }
        proposal.approvals.push(approverPublicKey);
        proposal.approvalCount++;
        if (proposal.approvalCount >= this.config.threshold) {
            proposal.status = types_1.ProposalStatus.Approved;
        }
        this.logger.info("Proposal approved", { proposalId, approvalCount: proposal.approvalCount });
        const { approvalCount, ...rest } = proposal;
        return rest;
    }
    /**
     * Execute a proposal.
     */
    executeProposal(executorPublicKey, proposalId) {
        this.checkFailure("executeProposal");
        if (!this.config) {
            throw new types_1.VaultError(types_1.VaultErrorCode.NotInitialized, "Vault not initialized");
        }
        const proposal = this.proposals.get(proposalId);
        if (!proposal) {
            throw new types_1.VaultError(types_1.VaultErrorCode.ProposalNotFound, `Proposal ${proposalId} not found`);
        }
        if (proposal.status !== types_1.ProposalStatus.Approved) {
            throw new types_1.VaultError(types_1.VaultErrorCode.ProposalNotApproved, "Proposal must be approved");
        }
        if (proposal.unlockLedger > 0n && this.currentLedger < proposal.unlockLedger) {
            throw new types_1.VaultError(types_1.VaultErrorCode.TimelockNotExpired, `Timelock expires at ledger ${proposal.unlockLedger}`);
        }
        proposal.status = types_1.ProposalStatus.Executed;
        this.logger.info("Proposal executed", { proposalId, amount: proposal.amount });
        const { approvalCount, ...rest } = proposal;
        return rest;
    }
    /**
     * Reject a proposal.
     */
    rejectProposal(rejecterPublicKey, proposalId) {
        this.checkFailure("rejectProposal");
        const proposal = this.proposals.get(proposalId);
        if (!proposal) {
            throw new types_1.VaultError(types_1.VaultErrorCode.ProposalNotFound, `Proposal ${proposalId} not found`);
        }
        if (proposal.status === types_1.ProposalStatus.Executed) {
            throw new types_1.VaultError(types_1.VaultErrorCode.ProposalAlreadyExecuted, "Cannot reject executed proposal");
        }
        proposal.status = types_1.ProposalStatus.Rejected;
        this.logger.info("Proposal rejected", { proposalId });
        const { approvalCount, ...rest } = proposal;
        return rest;
    }
    /**
     * Set a role for a user.
     */
    setRole(callerPublicKey, targetPublicKey, role) {
        this.checkFailure("setRole");
        const callerRole = this.getRole(callerPublicKey);
        if (callerRole !== types_1.Role.Admin) {
            throw new types_1.VaultError(types_1.VaultErrorCode.Unauthorized, "Only admins can set roles");
        }
        this.roles.set(targetPublicKey, role);
        this.logger.info("Role set", { target: targetPublicKey, role });
    }
    /**
     * Create a recurring payment.
     */
    schedulePayment(proposerPublicKey, recipient, token, amount, memo, intervalLedgers) {
        this.checkFailure("schedulePayment");
        if (!this.config) {
            throw new types_1.VaultError(types_1.VaultErrorCode.NotInitialized, "Vault not initialized");
        }
        const role = this.getRole(proposerPublicKey);
        if (role !== types_1.Role.Treasurer && role !== types_1.Role.Admin) {
            throw new types_1.VaultError(types_1.VaultErrorCode.InsufficientRole, "Only treasurers can schedule");
        }
        if (intervalLedgers < 720n) {
            throw new types_1.VaultError(types_1.VaultErrorCode.IntervalTooShort, "Interval must be at least 720 ledgers");
        }
        const id = this.recurringIdCounter++;
        const payment = {
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
    getRecurringPayment(id) {
        this.checkFailure("getRecurringPayment");
        const payment = this.recurringPayments.get(id);
        if (!payment) {
            throw new types_1.VaultError(types_1.VaultErrorCode.ProposalNotFound, `Recurring payment ${id} not found`);
        }
        const { createdAt, ...rest } = payment;
        return rest;
    }
    /**
     * Execute a recurring payment.
     */
    executeRecurringPayment(paymentId) {
        this.checkFailure("executeRecurringPayment");
        const payment = this.recurringPayments.get(paymentId);
        if (!payment) {
            throw new types_1.VaultError(types_1.VaultErrorCode.ProposalNotFound, `Recurring payment ${paymentId} not found`);
        }
        if (!payment.isActive) {
            throw new types_1.VaultError(types_1.VaultErrorCode.ProposalNotPending, "Payment is not active");
        }
        if (this.currentLedger < payment.nextPaymentLedger) {
            throw new types_1.VaultError(types_1.VaultErrorCode.ProposalNotPending, `Payment not due until ledger ${payment.nextPaymentLedger}`);
        }
        payment.nextPaymentLedger = payment.nextPaymentLedger + payment.interval;
        payment.paymentCount++;
        this.logger.info("Recurring payment executed", { paymentId, count: payment.paymentCount });
        const { createdAt, ...rest } = payment;
        return rest;
    }
    /**
     * Add a signer to the vault.
     */
    addSigner(adminPublicKey, signerPublicKey) {
        this.checkFailure("addSigner");
        const role = this.getRole(adminPublicKey);
        if (role !== types_1.Role.Admin) {
            throw new types_1.VaultError(types_1.VaultErrorCode.Unauthorized, "Only admins can add signers");
        }
        if (!this.config) {
            throw new types_1.VaultError(types_1.VaultErrorCode.NotInitialized, "Vault not initialized");
        }
        if (this.config.signers.includes(signerPublicKey)) {
            throw new types_1.VaultError(types_1.VaultErrorCode.SignerAlreadyExists, "Signer already exists");
        }
        this.config.signers.push(signerPublicKey);
        this.logger.info("Signer added", { signer: signerPublicKey });
    }
    /**
     * Remove a signer from the vault.
     */
    removeSigner(adminPublicKey, signerPublicKey) {
        this.checkFailure("removeSigner");
        const role = this.getRole(adminPublicKey);
        if (role !== types_1.Role.Admin) {
            throw new types_1.VaultError(types_1.VaultErrorCode.Unauthorized, "Only admins can remove signers");
        }
        if (!this.config) {
            throw new types_1.VaultError(types_1.VaultErrorCode.NotInitialized, "Vault not initialized");
        }
        const index = this.config.signers.indexOf(signerPublicKey);
        if (index === -1) {
            throw new types_1.VaultError(types_1.VaultErrorCode.SignerNotFound, "Signer not found");
        }
        this.config.signers.splice(index, 1);
        this.logger.info("Signer removed", { signer: signerPublicKey });
    }
    /**
     * Simulate a transaction or mock action and return state diffs showing created and modified keys.
     */
    simulateWithStateDiff(tx) {
        this.checkFailure("simulateWithStateDiff");
        if (typeof tx === "object" && tx !== null && ("modifiedKeys" in tx || "changes" in tx || "stateChanges" in tx)) {
            return (0, utils_1.extractStateDiff)(tx);
        }
        const changes = [];
        const modifiedKeys = {};
        const newKeys = [];
        if (typeof tx === "object" && tx !== null) {
            for (const [key, val] of Object.entries(tx)) {
                if (typeof val === "object" && val !== null && ("before" in val || "after" in val)) {
                    const before = val.before ?? null;
                    const after = val.after ?? null;
                    const isNew = before === null || before === undefined;
                    changes.push({ key, before, after, isNew });
                    if (isNew) {
                        newKeys.push(key);
                    }
                    else {
                        modifiedKeys[key] = { before, after };
                    }
                }
            }
        }
        if (changes.length === 0) {
            const configKey = "vault_config";
            if (this.config) {
                modifiedKeys[configKey] = {
                    before: { threshold: this.config.threshold },
                    after: { threshold: this.config.threshold, updated: true },
                };
                changes.push({
                    key: configKey,
                    before: { threshold: this.config.threshold },
                    after: { threshold: this.config.threshold, updated: true },
                    isNew: false,
                });
            }
        }
        return { modifiedKeys, newKeys, changes };
    }
    simulate_with_state_diff(tx) {
        return this.simulateWithStateDiff(tx);
    }
}
exports.MockVaultContract = MockVaultContract;
//# sourceMappingURL=mock-contract.js.map