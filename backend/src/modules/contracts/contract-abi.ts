/** Supported Soroban argument types for ABI validation. */
export type AbiArgType =
  | "Address"
  | "i128"
  | "u32"
  | "bool"
  | "Bytes"
  | "Symbol"
  | "Vec";

export interface AbiArg {
  readonly name: string;
  readonly type: AbiArgType;
}

export interface AbiFunctionSpec {
  readonly args: AbiArg[];
}

/** Full ABI for a contract version. */
export interface ContractABI {
  readonly version: string;
  readonly functions: Record<string, AbiFunctionSpec>;
}

export interface AbiValidationError {
  readonly fn_name: string;
  readonly error: string;
}

export type AbiValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: AbiValidationError };

/**
 * ABI for the token-lock contract.
 *
 * Issue #1746: a single address may hold more than one active lock. Locks are
 * keyed by an explicit `lock_id` so users can top up an existing lock or ladder
 * several locks with different durations. `set_total_locked` accumulates the
 * total locked amount across all of an owner's locks instead of overwriting it.
 */
export const TOKEN_LOCK_ABI: ContractABI = {
  version: "2.0.0",
  functions: {
    // Creates a new lock for `owner` and returns its `lock_id`. A second lock
    // is no longer rejected while another lock is active.
    lock_tokens: {
      args: [
        { name: "owner", type: "Address" },
        { name: "amount", type: "i128" },
        { name: "duration", type: "u32" },
      ],
    },
    // Tops up an existing lock identified by `lock_id`.
    increase_lock_amount: {
      args: [
        { name: "owner", type: "Address" },
        { name: "lock_id", type: "u32" },
        { name: "amount", type: "i128" },
      ],
    },
    // Accumulates the total locked amount for `owner` across all active locks.
    set_total_locked: {
      args: [
        { name: "owner", type: "Address" },
        { name: "amount", type: "i128" },
      ],
    },
    // Returns the accumulated total locked amount for `owner`.
    get_total_locked: {
      args: [{ name: "owner", type: "Address" }],
    },
    // Returns the voting power derived from all of `owner`'s active locks.
    get_voting_power: {
      args: [{ name: "owner", type: "Address" }],
    },
  },
};
