/**
 * Snapshot error taxonomy.
 *
 * The snapshot service retries *transient* persistence failures and gives up on
 * permanent ones. Deciding that by matching substrings in an error message is
 * brittle — `/lock/i` also matches "block"/"clock", and a word such as
 * "invalid" wins purely because of pattern order. Instead, storage and network
 * failures are represented by the typed classes below so the service can
 * classify them by type. The regex patterns remain only as a fallback for
 * third-party errors we cannot type.
 */

export type FailureDisposition = "transient" | "permanent";

/** A stored snapshot does not match the auditor commitment recorded at save time. */
export class SnapshotRootMismatchError extends Error {
  constructor(
    readonly contractId: string,
    readonly snapshotId: string,
  ) {
    super(`Snapshot integrity root mismatch for ${contractId}/${snapshotId}`);
    this.name = "SnapshotRootMismatchError";
  }
}

/**
 * Base class for snapshot storage/network failures. Adapters should throw a
 * subclass so the service can tell transient failures from permanent ones
 * without inspecting the message.
 */
export class SnapshotOperationError extends Error {
  readonly disposition: FailureDisposition;

  constructor(
    message: string,
    disposition: FailureDisposition,
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = new.target.name;
    this.disposition = disposition;
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

/** A storage failure that may succeed if retried (lock contention, I/O stall). */
export class TransientStorageError extends SnapshotOperationError {
  constructor(
    message = "transient storage failure",
    options?: { cause?: unknown },
  ) {
    super(message, "transient", options);
  }
}

/** A storage failure that will not be fixed by retrying (bad schema, constraint). */
export class PermanentStorageError extends SnapshotOperationError {
  constructor(
    message = "permanent storage failure",
    options?: { cause?: unknown },
  ) {
    super(message, "permanent", options);
  }
}

/** A network failure that may succeed if retried (timeout, reset, refused). */
export class TransientNetworkError extends SnapshotOperationError {
  constructor(
    message = "transient network failure",
    options?: { cause?: unknown },
  ) {
    super(message, "transient", options);
  }
}

/** A network failure that will not be fixed by retrying (bad request, auth). */
export class PermanentNetworkError extends SnapshotOperationError {
  constructor(
    message = "permanent network failure",
    options?: { cause?: unknown },
  ) {
    super(message, "permanent", options);
  }
}

/**
 * Fallback heuristics for third-party errors that are not instances of the
 * typed classes above. These are intentionally narrow: `/lock/i` was tightened
 * to whole-word matches so "block"/"clock" are no longer treated as locks.
 */
const TRANSIENT_ERROR_PATTERNS: readonly RegExp[] = [
  /\blocked\b/i,
  /\bdeadlock\b/i,
  /timeout/i,
  /busy/i,
  /econnreset/i,
  /econnrefused/i,
  /socket/i,
];

const PERMANENT_ERROR_PATTERNS: readonly RegExp[] = [
  /validation/i,
  /schema/i,
  /invalid/i,
  /constraint/i,
];

function describeError(err: unknown): string {
  if (err instanceof Error) {
    return `${err.name}: ${err.message}`;
  }
  return String(err);
}

/**
 * Returns `true` when a failed snapshot operation is worth retrying.
 *
 * Typed `SnapshotOperationError`s are classified by their declared
 * `disposition`; the message patterns are only consulted for errors that do not
 * carry a type (e.g. an error thrown by a database driver).
 */
export function isTransientError(err: unknown): boolean {
  if (err instanceof SnapshotOperationError) {
    return err.disposition === "transient";
  }

  const msg = describeError(err);
  if (PERMANENT_ERROR_PATTERNS.some((p) => p.test(msg))) return false;
  return TRANSIENT_ERROR_PATTERNS.some((p) => p.test(msg));
}
