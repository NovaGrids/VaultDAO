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

import { VaultErrorCode } from "./types";

// ---------------------------------------------------------------------------
// Registry types
// ---------------------------------------------------------------------------

/** A single entry in the error code registry. */
export interface ErrorRegistryEntry {
  /** The numeric error code (matches the on-chain variant). */
  code: VaultErrorCode;
  /** Symbolic name, e.g. `"AlreadyInitialized"`. */
  name: string;
  /** Short human-readable description of what caused the error. */
  description: string;
  /** An example of when this error would be thrown. */
  example: string;
  /** Broad category this error belongs to. */
  category:
    | "Initialization"
    | "Authorization"
    | "Proposal"
    | "SpendingLimits"
    | "Configuration"
    | "Token"
    | "Recurring"
    | "Streaming"
    | "Bridge"
    | "Subscription"
    | "Escrow"
    | "Template"
    | "Tag"
    | "Staking"
    | "Delegation"
    | "CommitReveal"
    | "ColdSignature"
    | "Pause"
    | "Upgrade"
    | "Insurance"
    | "Dispute"
    | "Compliance"
    | "Metrics"
    | "Batch"
    | "Comment"
    | "Capability"
    | "Other";
}

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
export const ERROR_REGISTRY: Readonly<
  Record<VaultErrorCode, ErrorRegistryEntry>
> = {
  // -------------------------------------------------------------------------
  // Initialization (1xx)
  // -------------------------------------------------------------------------
  [VaultErrorCode.AlreadyInitialized]: {
    code: VaultErrorCode.AlreadyInitialized,
    name: "AlreadyInitialized",
    category: "Initialization",
    description: "Vault has already been initialized.",
    example:
      "Calling initialize() a second time on an existing vault returns this error.",
  },
  [VaultErrorCode.NotInitialized]: {
    code: VaultErrorCode.NotInitialized,
    name: "NotInitialized",
    category: "Initialization",
    description:
      "Vault has not been initialized yet. Call initialize() first.",
    example:
      "Calling proposeTransfer() before initialize() returns this error.",
  },

  // -------------------------------------------------------------------------
  // Authorization (2xx)
  // -------------------------------------------------------------------------
  [VaultErrorCode.Unauthorized]: {
    code: VaultErrorCode.Unauthorized,
    name: "Unauthorized",
    category: "Authorization",
    description:
      "Caller is not authorized to perform this action.",
    example:
      "A non-signer address attempting to approve a proposal returns this error.",
  },
  [VaultErrorCode.NotASigner]: {
    code: VaultErrorCode.NotASigner,
    name: "NotASigner",
    category: "Authorization",
    description: "Address is not registered in the vault's signer set.",
    example:
      "An address that was never added via addSigner() trying to vote on a proposal.",
  },
  [VaultErrorCode.InsufficientRole]: {
    code: VaultErrorCode.InsufficientRole,
    name: "InsufficientRole",
    category: "Authorization",
    description:
      "Caller's role is too low for the requested operation.",
    example:
      "A Member (role 0) calling proposeTransfer(), which requires at least Treasurer (role 1).",
  },

  // -------------------------------------------------------------------------
  // Proposal (3xx)
  // -------------------------------------------------------------------------
  [VaultErrorCode.ProposalNotFound]: {
    code: VaultErrorCode.ProposalNotFound,
    name: "ProposalNotFound",
    category: "Proposal",
    description: "No proposal with the given ID exists in the vault.",
    example: "getProposal(999n) when only proposals 1–5 have been created.",
  },
  [VaultErrorCode.ProposalNotPending]: {
    code: VaultErrorCode.ProposalNotPending,
    name: "ProposalNotPending",
    category: "Proposal",
    description:
      "Proposal is not in Pending status and cannot be approved or voted on.",
    example:
      "Calling approveProposal() on a proposal that has already been Executed or Rejected.",
  },
  [VaultErrorCode.AlreadyApproved]: {
    code: VaultErrorCode.AlreadyApproved,
    name: "AlreadyApproved",
    category: "Proposal",
    description: "Signer has already cast an approval for this proposal.",
    example: "The same signer calling approveProposal() twice for proposal #1.",
  },
  [VaultErrorCode.ProposalExpired]: {
    code: VaultErrorCode.ProposalExpired,
    name: "ProposalExpired",
    category: "Proposal",
    description:
      "Proposal's expiry ledger has passed and it can no longer be executed.",
    example:
      "Trying to executeProposal() after the expiresAt ledger has been reached.",
  },
  [VaultErrorCode.ProposalNotApproved]: {
    code: VaultErrorCode.ProposalNotApproved,
    name: "ProposalNotApproved",
    category: "Proposal",
    description:
      "Proposal has not yet reached the approval threshold.",
    example:
      "Calling executeProposal() when only 1 of 3 required signers has approved.",
  },
  [VaultErrorCode.ProposalAlreadyExecuted]: {
    code: VaultErrorCode.ProposalAlreadyExecuted,
    name: "ProposalAlreadyExecuted",
    category: "Proposal",
    description: "Proposal has already been executed and funds transferred.",
    example:
      "Calling executeProposal() a second time on an already-executed proposal.",
  },

  // -------------------------------------------------------------------------
  // Spending limits (4xx)
  // -------------------------------------------------------------------------
  [VaultErrorCode.ExceedsProposalLimit]: {
    code: VaultErrorCode.ExceedsProposalLimit,
    name: "ExceedsProposalLimit",
    category: "SpendingLimits",
    description:
      "Proposed amount exceeds the per-proposal spending cap configured at vault initialization.",
    example:
      "Proposing a transfer of 2 000 XLM when the spendingLimit is 1 000 XLM.",
  },
  [VaultErrorCode.ExceedsDailyLimit]: {
    code: VaultErrorCode.ExceedsDailyLimit,
    name: "ExceedsDailyLimit",
    category: "SpendingLimits",
    description:
      "Transfer would exceed the vault's cumulative daily outflow limit.",
    example:
      "A second proposal today that would push the running daily total above dailyLimit.",
  },
  [VaultErrorCode.ExceedsWeeklyLimit]: {
    code: VaultErrorCode.ExceedsWeeklyLimit,
    name: "ExceedsWeeklyLimit",
    category: "SpendingLimits",
    description:
      "Transfer would exceed the vault's cumulative weekly outflow limit.",
    example:
      "Cumulative weekly transfers already at the weeklyLimit; one more is rejected.",
  },
  [VaultErrorCode.InvalidAmount]: {
    code: VaultErrorCode.InvalidAmount,
    name: "InvalidAmount",
    category: "SpendingLimits",
    description: "Amount is zero, negative, or otherwise invalid.",
    example: "Calling proposeTransfer() with amount = 0n.",
  },
  [VaultErrorCode.TimelockNotExpired]: {
    code: VaultErrorCode.TimelockNotExpired,
    name: "TimelockNotExpired",
    category: "SpendingLimits",
    description:
      "Large-transfer timelock has not elapsed; execution is not yet permitted.",
    example:
      "Executing a high-value proposal before its unlockLedger has been reached.",
  },
  [VaultErrorCode.IntervalTooShort]: {
    code: VaultErrorCode.IntervalTooShort,
    name: "IntervalTooShort",
    category: "Recurring",
    description:
      "Recurring payment interval is below the minimum of 720 ledgers (~1 hour).",
    example:
      "Calling schedulePayment() with interval = 100n (less than 720 ledgers).",
  },

  // -------------------------------------------------------------------------
  // Configuration (5xx)
  // -------------------------------------------------------------------------
  [VaultErrorCode.ThresholdTooLow]: {
    code: VaultErrorCode.ThresholdTooLow,
    name: "ThresholdTooLow",
    category: "Configuration",
    description: "Proposed threshold is zero, which is not allowed.",
    example: "Calling updateThreshold(0) on an active vault.",
  },
  [VaultErrorCode.ThresholdTooHigh]: {
    code: VaultErrorCode.ThresholdTooHigh,
    name: "ThresholdTooHigh",
    category: "Configuration",
    description:
      "Proposed threshold exceeds the current number of registered signers.",
    example:
      "Setting threshold to 5 when only 3 signers exist.",
  },
  [VaultErrorCode.SignerAlreadyExists]: {
    code: VaultErrorCode.SignerAlreadyExists,
    name: "SignerAlreadyExists",
    category: "Configuration",
    description: "Address is already in the vault's signer set.",
    example: "Calling addSigner() with an address that was already added.",
  },
  [VaultErrorCode.SignerNotFound]: {
    code: VaultErrorCode.SignerNotFound,
    name: "SignerNotFound",
    category: "Configuration",
    description: "Address is not a registered signer and cannot be removed.",
    example: "Calling removeSigner() with an address that was never added.",
  },
  [VaultErrorCode.CannotRemoveSigner]: {
    code: VaultErrorCode.CannotRemoveSigner,
    name: "CannotRemoveSigner",
    category: "Configuration",
    description:
      "Removing this signer would drop the signer count below the current threshold.",
    example:
      "Removing the last signer when threshold is 1 would leave no signers.",
  },
  [VaultErrorCode.NoSigners]: {
    code: VaultErrorCode.NoSigners,
    name: "NoSigners",
    category: "Configuration",
    description: "Vault was initialized with an empty signer list.",
    example: "Calling initialize() with signers: [].",
  },

  // -------------------------------------------------------------------------
  // Token (6xx)
  // -------------------------------------------------------------------------
  [VaultErrorCode.TransferFailed]: {
    code: VaultErrorCode.TransferFailed,
    name: "TransferFailed",
    category: "Token",
    description:
      "The on-chain token transfer invocation returned an error.",
    example:
      "The SAC transfer call reverted, possibly because the token contract rejected it.",
  },
  [VaultErrorCode.InsufficientBalance]: {
    code: VaultErrorCode.InsufficientBalance,
    name: "InsufficientBalance",
    category: "Token",
    description:
      "Vault's token balance is lower than the requested transfer amount.",
    example:
      "Attempting to send 500 XLM when the vault only holds 100 XLM.",
  },
} as const;

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
export function getErrorEntry(
  code: VaultErrorCode
): ErrorRegistryEntry | undefined {
  return ERROR_REGISTRY[code];
}

/**
 * Return only the human-readable description for a known error code,
 * or `undefined` if the code is not in the registry.
 *
 * @example
 * const desc = getErrorDescription(VaultErrorCode.ProposalNotFound);
 * // "No proposal with the given ID exists in the vault."
 */
export function getErrorDescription(
  code: VaultErrorCode
): string | undefined {
  return ERROR_REGISTRY[code]?.description;
}

/**
 * Return every registered {@link ErrorRegistryEntry} sorted by error code.
 *
 * @example
 * for (const entry of getAllErrorEntries()) {
 *   console.log(`${entry.code} ${entry.name}: ${entry.description}`);
 * }
 */
export function getAllErrorEntries(): ErrorRegistryEntry[] {
  return (Object.values(ERROR_REGISTRY) as ErrorRegistryEntry[]).sort(
    (a, b) => a.code - b.code
  );
}
