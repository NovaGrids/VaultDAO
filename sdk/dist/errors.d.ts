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
    category: "Initialization" | "Authorization" | "Proposal" | "SpendingLimits" | "Configuration" | "Token" | "Recurring" | "Streaming" | "Bridge" | "Subscription" | "Escrow" | "Template" | "Tag" | "Staking" | "Delegation" | "CommitReveal" | "ColdSignature" | "Pause" | "Upgrade" | "Insurance" | "Dispute" | "Compliance" | "Metrics" | "Batch" | "Comment" | "Capability" | "Other";
}
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
export declare const ERROR_REGISTRY: Readonly<Record<VaultErrorCode, ErrorRegistryEntry>>;
/**
 * Return the full {@link ErrorRegistryEntry} for a known error code,
 * or `undefined` if the code is not in the registry.
 *
 * @example
 * const entry = getErrorEntry(VaultErrorCode.Unauthorized);
 * console.log(entry?.description); // "Caller is not authorized..."
 */
export declare function getErrorEntry(code: VaultErrorCode): ErrorRegistryEntry | undefined;
/**
 * Return only the human-readable description for a known error code,
 * or `undefined` if the code is not in the registry.
 *
 * @example
 * const desc = getErrorDescription(VaultErrorCode.ProposalNotFound);
 * // "No proposal with the given ID exists in the vault."
 */
export declare function getErrorDescription(code: VaultErrorCode): string | undefined;
/**
 * Return every registered {@link ErrorRegistryEntry} sorted by error code.
 *
 * @example
 * for (const entry of getAllErrorEntries()) {
 *   console.log(`${entry.code} ${entry.name}: ${entry.description}`);
 * }
 */
export declare function getAllErrorEntries(): ErrorRegistryEntry[];
//# sourceMappingURL=errors.d.ts.map