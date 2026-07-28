"use strict";
/**
 * VaultDAO SDK — Error Code Registry
 *
 * Maps every on-chain {@link VaultErrorCode} to a human-readable description
 * and an example of how the error manifests.
 *
 * Use {@link getErrorDescription} for a single description,
 * {@link getErrorEntry} for the full registry entry, or
 * {@link ERROR_REGISTRY} to iterate over all entries.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ERROR_REGISTRY = void 0;
exports.getErrorEntry = getErrorEntry;
exports.getErrorDescription = getErrorDescription;
exports.getAllErrorEntries = getAllErrorEntries;
const types_1 = require("./types");
// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------
/**
 * Complete registry of all VaultDAO error codes.
 *
 * Entries are keyed by their numeric {@link VaultErrorCode}.
 *
 * @example
 * import { ERROR_REGISTRY } from "@vaultdao/sdk";
 *
 * const entry = ERROR_REGISTRY[100];
 * console.log(entry.description); // "Vault has already been initialized"
 */
exports.ERROR_REGISTRY = {
    // -------------------------------------------------------------------------
    // Initialization (1xx)
    // -------------------------------------------------------------------------
    [types_1.VaultErrorCode.AlreadyInitialized]: {
        code: types_1.VaultErrorCode.AlreadyInitialized,
        name: "AlreadyInitialized",
        category: "Initialization",
        description: "Vault has already been initialized.",
        example: "Calling initialize() a second time on an existing vault returns this error.",
    },
    [types_1.VaultErrorCode.NotInitialized]: {
        code: types_1.VaultErrorCode.NotInitialized,
        name: "NotInitialized",
        category: "Initialization",
        description: "Vault has not been initialized yet. Call initialize() first.",
        example: "Calling proposeTransfer() before initialize() returns this error.",
    },
    // -------------------------------------------------------------------------
    // Authorization (2xx)
    // -------------------------------------------------------------------------
    [types_1.VaultErrorCode.Unauthorized]: {
        code: types_1.VaultErrorCode.Unauthorized,
        name: "Unauthorized",
        category: "Authorization",
        description: "Caller is not authorized to perform this action.",
        example: "A non-signer address attempting to approve a proposal returns this error.",
    },
    [types_1.VaultErrorCode.NotASigner]: {
        code: types_1.VaultErrorCode.NotASigner,
        name: "NotASigner",
        category: "Authorization",
        description: "Address is not registered in the vault's signer set.",
        example: "An address that was never added via addSigner() trying to vote on a proposal.",
    },
    [types_1.VaultErrorCode.InsufficientRole]: {
        code: types_1.VaultErrorCode.InsufficientRole,
        name: "InsufficientRole",
        category: "Authorization",
        description: "Caller's role is too low for the requested operation.",
        example: "A Member (role 0) calling proposeTransfer(), which requires at least Treasurer (role 1).",
    },
    // -------------------------------------------------------------------------
    // Proposal (3xx)
    // -------------------------------------------------------------------------
    [types_1.VaultErrorCode.ProposalNotFound]: {
        code: types_1.VaultErrorCode.ProposalNotFound,
        name: "ProposalNotFound",
        category: "Proposal",
        description: "No proposal with the given ID exists in the vault.",
        example: "getProposal(999n) when only proposals 1–5 have been created.",
    },
    [types_1.VaultErrorCode.ProposalNotPending]: {
        code: types_1.VaultErrorCode.ProposalNotPending,
        name: "ProposalNotPending",
        category: "Proposal",
        description: "Proposal is not in Pending status and cannot be approved or voted on.",
        example: "Calling approveProposal() on a proposal that has already been Executed or Rejected.",
    },
    [types_1.VaultErrorCode.AlreadyApproved]: {
        code: types_1.VaultErrorCode.AlreadyApproved,
        name: "AlreadyApproved",
        category: "Proposal",
        description: "Signer has already cast an approval for this proposal.",
        example: "The same signer calling approveProposal() twice for proposal #1.",
    },
    [types_1.VaultErrorCode.ProposalExpired]: {
        code: types_1.VaultErrorCode.ProposalExpired,
        name: "ProposalExpired",
        category: "Proposal",
        description: "Proposal's expiry ledger has passed and it can no longer be executed.",
        example: "Trying to executeProposal() after the expiresAt ledger has been reached.",
    },
    [types_1.VaultErrorCode.ProposalNotApproved]: {
        code: types_1.VaultErrorCode.ProposalNotApproved,
        name: "ProposalNotApproved",
        category: "Proposal",
        description: "Proposal has not yet reached the approval threshold.",
        example: "Calling executeProposal() when only 1 of 3 required signers has approved.",
    },
    [types_1.VaultErrorCode.ProposalAlreadyExecuted]: {
        code: types_1.VaultErrorCode.ProposalAlreadyExecuted,
        name: "ProposalAlreadyExecuted",
        category: "Proposal",
        description: "Proposal has already been executed and funds transferred.",
        example: "Calling executeProposal() a second time on an already-executed proposal.",
    },
    // -------------------------------------------------------------------------
    // Spending limits (4xx)
    // -------------------------------------------------------------------------
    [types_1.VaultErrorCode.ExceedsProposalLimit]: {
        code: types_1.VaultErrorCode.ExceedsProposalLimit,
        name: "ExceedsProposalLimit",
        category: "SpendingLimits",
        description: "Proposed amount exceeds the per-proposal spending cap configured at vault initialization.",
        example: "Proposing a transfer of 2 000 XLM when the spendingLimit is 1 000 XLM.",
    },
    [types_1.VaultErrorCode.ExceedsDailyLimit]: {
        code: types_1.VaultErrorCode.ExceedsDailyLimit,
        name: "ExceedsDailyLimit",
        category: "SpendingLimits",
        description: "Transfer would exceed the vault's cumulative daily outflow limit.",
        example: "A second proposal today that would push the running daily total above dailyLimit.",
    },
    [types_1.VaultErrorCode.ExceedsWeeklyLimit]: {
        code: types_1.VaultErrorCode.ExceedsWeeklyLimit,
        name: "ExceedsWeeklyLimit",
        category: "SpendingLimits",
        description: "Transfer would exceed the vault's cumulative weekly outflow limit.",
        example: "Cumulative weekly transfers already at the weeklyLimit; one more is rejected.",
    },
    [types_1.VaultErrorCode.InvalidAmount]: {
        code: types_1.VaultErrorCode.InvalidAmount,
        name: "InvalidAmount",
        category: "SpendingLimits",
        description: "Amount is zero, negative, or otherwise invalid.",
        example: "Calling proposeTransfer() with amount = 0n.",
    },
    [types_1.VaultErrorCode.TimelockNotExpired]: {
        code: types_1.VaultErrorCode.TimelockNotExpired,
        name: "TimelockNotExpired",
        category: "SpendingLimits",
        description: "Large-transfer timelock has not elapsed; execution is not yet permitted.",
        example: "Executing a high-value proposal before its unlockLedger has been reached.",
    },
    [types_1.VaultErrorCode.IntervalTooShort]: {
        code: types_1.VaultErrorCode.IntervalTooShort,
        name: "IntervalTooShort",
        category: "Recurring",
        description: "Recurring payment interval is below the minimum of 720 ledgers (~1 hour).",
        example: "Calling schedulePayment() with interval = 100n (less than 720 ledgers).",
    },
    // -------------------------------------------------------------------------
    // Configuration (5xx)
    // -------------------------------------------------------------------------
    [types_1.VaultErrorCode.ThresholdTooLow]: {
        code: types_1.VaultErrorCode.ThresholdTooLow,
        name: "ThresholdTooLow",
        category: "Configuration",
        description: "Proposed threshold is zero, which is not allowed.",
        example: "Calling updateThreshold(0) on an active vault.",
    },
    [types_1.VaultErrorCode.ThresholdTooHigh]: {
        code: types_1.VaultErrorCode.ThresholdTooHigh,
        name: "ThresholdTooHigh",
        category: "Configuration",
        description: "Proposed threshold exceeds the current number of registered signers.",
        example: "Setting threshold to 5 when only 3 signers exist.",
    },
    [types_1.VaultErrorCode.SignerAlreadyExists]: {
        code: types_1.VaultErrorCode.SignerAlreadyExists,
        name: "SignerAlreadyExists",
        category: "Configuration",
        description: "Address is already in the vault's signer set.",
        example: "Calling addSigner() with an address that was already added.",
    },
    [types_1.VaultErrorCode.SignerNotFound]: {
        code: types_1.VaultErrorCode.SignerNotFound,
        name: "SignerNotFound",
        category: "Configuration",
        description: "Address is not a registered signer and cannot be removed.",
        example: "Calling removeSigner() with an address that was never added.",
    },
    [types_1.VaultErrorCode.CannotRemoveSigner]: {
        code: types_1.VaultErrorCode.CannotRemoveSigner,
        name: "CannotRemoveSigner",
        category: "Configuration",
        description: "Removing this signer would drop the signer count below the current threshold.",
        example: "Removing the last signer when threshold is 1 would leave no signers.",
    },
    [types_1.VaultErrorCode.NoSigners]: {
        code: types_1.VaultErrorCode.NoSigners,
        name: "NoSigners",
        category: "Configuration",
        description: "Vault was initialized with an empty signer list.",
        example: "Calling initialize() with signers: [].",
    },
    // -------------------------------------------------------------------------
    // Token (6xx)
    // -------------------------------------------------------------------------
    [types_1.VaultErrorCode.TransferFailed]: {
        code: types_1.VaultErrorCode.TransferFailed,
        name: "TransferFailed",
        category: "Token",
        description: "The on-chain token transfer invocation returned an error.",
        example: "The SAC transfer call reverted, possibly because the token contract rejected it.",
    },
    [types_1.VaultErrorCode.InsufficientBalance]: {
        code: types_1.VaultErrorCode.InsufficientBalance,
        name: "InsufficientBalance",
        category: "Token",
        description: "Vault's token balance is lower than the requested transfer amount.",
        example: "Attempting to send 500 XLM when the vault only holds 100 XLM.",
    },
};
// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------
/**
 * Return the full {@link ErrorRegistryEntry} for a known error code,
 * or `undefined` if the code is not in the registry.
 *
 * @example
 * const entry = getErrorEntry(VaultErrorCode.Unauthorized);
 * console.log(entry?.description); // "Caller is not authorized..."
 */
function getErrorEntry(code) {
    return exports.ERROR_REGISTRY[code];
}
/**
 * Return only the human-readable description for a known error code,
 * or `undefined` if the code is not in the registry.
 *
 * @example
 * const desc = getErrorDescription(VaultErrorCode.ProposalNotFound);
 * // "No proposal with the given ID exists in the vault."
 */
function getErrorDescription(code) {
    return exports.ERROR_REGISTRY[code]?.description;
}
/**
 * Return every registered {@link ErrorRegistryEntry} sorted by error code.
 *
 * @example
 * for (const entry of getAllErrorEntries()) {
 *   console.log(`${entry.code} ${entry.name}: ${entry.description}`);
 * }
 */
function getAllErrorEntries() {
    return Object.values(exports.ERROR_REGISTRY).sort((a, b) => a.code - b.code);
}
//# sourceMappingURL=errors.js.map