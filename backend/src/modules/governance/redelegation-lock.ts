/**
 * Redelegation lock policy (issue #2223).
 *
 * Vaults that opt in freeze their delegation for the lifetime of an open
 * ballot. Power cannot be flash-reassigned mid-vote: a redirect is only
 * accepted when no ballot is open and any explicit lock has expired.
 */

export interface RedelegationLockParams {
  /** Whether this vault opts into ballot-scoped redelegation locks. */
  optIn: boolean;
  /** Extra ledgers a delegation stays locked after the ballot closes. */
  lockLedgers: number;
}

export const DEFAULT_REDELEGATION_LOCK_PARAMS: Readonly<RedelegationLockParams> =
  Object.freeze({ optIn: false, lockLedgers: 0 });

export const DELEGATION_EVENTS = [
  "delegate",
  "undelegate",
  "lock",
  "unlock",
] as const;

export type DelegationEvent = (typeof DELEGATION_EVENTS)[number];

export function validateRedelegationLockParams(
  params: RedelegationLockParams,
): string[] {
  const errors: string[] = [];
  if (typeof params.optIn !== "boolean") errors.push("optIn must be a boolean");
  if (!Number.isInteger(params.lockLedgers) || params.lockLedgers < 0) {
    errors.push("lockLedgers must be a non-negative integer");
  }
  return errors;
}

export interface RedelegationState {
  params: RedelegationLockParams;
  ballotOpen: boolean;
  lockedUntilLedger: number;
  nowLedger: number;
}

export function isRedelegationLocked(state: RedelegationState): boolean {
  const errors = validateRedelegationLockParams(state.params);
  if (errors.length > 0) {
    throw new Error(`Invalid redelegation lock params: ${errors.join("; ")}`);
  }
  if (!state.params.optIn) return false;
  return state.ballotOpen || state.nowLedger < state.lockedUntilLedger;
}

/** Throws `REDELEGATION_LOCKED` when a redirect would be mid-ballot. */
export function assertRedelegationAllowed(state: RedelegationState): void {
  if (isRedelegationLocked(state)) {
    throw new Error("REDELEGATION_LOCKED");
  }
}
