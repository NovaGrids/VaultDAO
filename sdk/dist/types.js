"use strict";
/**
 * VaultDAO SDK — Type Definitions
 *
 * Mirrors the Soroban contract types defined in contracts/vault/src/types.rs
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.noopLogger = exports.VaultError = exports.VaultErrorCode = exports.ProposalStatus = exports.Role = void 0;
// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
/** Permissions assigned to vault participants. */
var Role;
(function (Role) {
    /** Read-only access (default). */
    Role[Role["Member"] = 0] = "Member";
    /** Can create and approve transfer proposals. */
    Role[Role["Treasurer"] = 1] = "Treasurer";
    /** Full control: manages roles, signers, and configuration. */
    Role[Role["Admin"] = 2] = "Admin";
})(Role || (exports.Role = Role = {}));
/** Lifecycle states of a transfer proposal. */
var ProposalStatus;
(function (ProposalStatus) {
    /** Awaiting more approvals. */
    ProposalStatus[ProposalStatus["Pending"] = 0] = "Pending";
    /** Approval threshold met; ready for execution. */
    ProposalStatus[ProposalStatus["Approved"] = 1] = "Approved";
    /** Funds transferred and record finalised. */
    ProposalStatus[ProposalStatus["Executed"] = 2] = "Executed";
    /** Cancelled by Admin or the original proposer. */
    ProposalStatus[ProposalStatus["Rejected"] = 3] = "Rejected";
    /** Expired without reaching the approval threshold. */
    ProposalStatus[ProposalStatus["Expired"] = 4] = "Expired";
})(ProposalStatus || (exports.ProposalStatus = ProposalStatus = {}));
// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------
/**
 * All error codes emitted by the VaultDAO contract.
 * The numeric value matches the on-chain `VaultError` variant.
 */
var VaultErrorCode;
(function (VaultErrorCode) {
    // 1xx — Initialization
    VaultErrorCode[VaultErrorCode["AlreadyInitialized"] = 100] = "AlreadyInitialized";
    VaultErrorCode[VaultErrorCode["NotInitialized"] = 101] = "NotInitialized";
    // 2xx — Authorization
    VaultErrorCode[VaultErrorCode["Unauthorized"] = 200] = "Unauthorized";
    VaultErrorCode[VaultErrorCode["NotASigner"] = 201] = "NotASigner";
    VaultErrorCode[VaultErrorCode["InsufficientRole"] = 202] = "InsufficientRole";
    // 3xx — Proposal
    VaultErrorCode[VaultErrorCode["ProposalNotFound"] = 300] = "ProposalNotFound";
    VaultErrorCode[VaultErrorCode["ProposalNotPending"] = 301] = "ProposalNotPending";
    VaultErrorCode[VaultErrorCode["AlreadyApproved"] = 302] = "AlreadyApproved";
    VaultErrorCode[VaultErrorCode["ProposalExpired"] = 303] = "ProposalExpired";
    VaultErrorCode[VaultErrorCode["ProposalNotApproved"] = 304] = "ProposalNotApproved";
    VaultErrorCode[VaultErrorCode["ProposalAlreadyExecuted"] = 305] = "ProposalAlreadyExecuted";
    // 4xx — Spending limits
    VaultErrorCode[VaultErrorCode["ExceedsProposalLimit"] = 400] = "ExceedsProposalLimit";
    VaultErrorCode[VaultErrorCode["ExceedsDailyLimit"] = 401] = "ExceedsDailyLimit";
    VaultErrorCode[VaultErrorCode["ExceedsWeeklyLimit"] = 402] = "ExceedsWeeklyLimit";
    VaultErrorCode[VaultErrorCode["InvalidAmount"] = 403] = "InvalidAmount";
    VaultErrorCode[VaultErrorCode["TimelockNotExpired"] = 404] = "TimelockNotExpired";
    VaultErrorCode[VaultErrorCode["IntervalTooShort"] = 405] = "IntervalTooShort";
    // 5xx — Configuration
    VaultErrorCode[VaultErrorCode["ThresholdTooLow"] = 500] = "ThresholdTooLow";
    VaultErrorCode[VaultErrorCode["ThresholdTooHigh"] = 501] = "ThresholdTooHigh";
    VaultErrorCode[VaultErrorCode["SignerAlreadyExists"] = 502] = "SignerAlreadyExists";
    VaultErrorCode[VaultErrorCode["SignerNotFound"] = 503] = "SignerNotFound";
    VaultErrorCode[VaultErrorCode["CannotRemoveSigner"] = 504] = "CannotRemoveSigner";
    VaultErrorCode[VaultErrorCode["NoSigners"] = 505] = "NoSigners";
    // 6xx — Token
    VaultErrorCode[VaultErrorCode["TransferFailed"] = 600] = "TransferFailed";
    VaultErrorCode[VaultErrorCode["InsufficientBalance"] = 601] = "InsufficientBalance";
})(VaultErrorCode || (exports.VaultErrorCode = VaultErrorCode = {}));
/** Thrown when the contract returns a known error code. */
class VaultError extends Error {
    constructor(code, message) {
        const fallback = `VaultError(${code}): ${VaultErrorCode[code]}`;
        super(message ?? fallback);
        this.code = code;
        this.name = "VaultError";
        this.description = message ?? fallback;
    }
    toJSON() {
        return {
            name: this.name,
            code: this.code,
            message: this.message,
            description: this.description,
        };
    }
}
exports.VaultError = VaultError;
/**
 * A silent no-op logger used when no custom logger is provided.
 * All methods are empty and impose zero runtime overhead.
 */
exports.noopLogger = {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    debug: () => { },
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    info: () => { },
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    warn: () => { },
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    error: () => { },
};
//# sourceMappingURL=types.js.map