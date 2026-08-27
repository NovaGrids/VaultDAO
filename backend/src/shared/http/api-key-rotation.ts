/**
 * API Key Rotation State
 *
 * Owns the pair of API keys the backend accepts during a zero-downtime
 * rotation: the `primary` key (the one clients use today) and the optional
 * `next` key (pre-provisioned so clients can migrate before the cutover).
 *
 * Keeping this state behind a small class — rather than a bare mutable
 * object — gives the rotation a single, auditable mutation point. `rotate()`
 * swaps both fields in one synchronous step, so no request can ever observe
 * a half-rotated state where both keys are the same or both are cleared.
 */

/** Snapshot of the currently accepted keys, as read by the auth middleware. */
export interface ApiKeyStateSnapshot {
  readonly primaryKey?: string;
  readonly nextKey?: string;
}

/** Outcome of a successful rotation. */
export interface RotationResult {
  /** Always false immediately after a rotation — `next` has been consumed. */
  readonly rotationPending: boolean;
  /** Always false — the pre-rotation key no longer authenticates anything. */
  readonly oldKeyActive: boolean;
  /** ISO-8601 timestamp of the rotation, for audit logs. */
  readonly rotatedAt: string;
}

/**
 * Raised when a rotation is requested but no `next` key has been staged.
 * The caller maps this to a 409 — rotating with nothing to rotate to would
 * lock every client out.
 */
export class NoPendingRotationError extends Error {
  constructor() {
    super("No pending API key rotation");
    this.name = "NoPendingRotationError";
  }
}

export class ApiKeyRotationState {
  private primary: string | undefined;
  private next: string | undefined;
  private lastRotatedAt: string | undefined;

  constructor(primary?: string, next?: string) {
    this.primary = primary;
    this.next = next;
  }

  /** The key that authorises admin operations, including rotation itself. */
  public getPrimaryKey(): string | undefined {
    return this.primary;
  }

  /** The staged replacement key, if a rotation has been prepared. */
  public getNextKey(): string | undefined {
    return this.next;
  }

  /** True while a `next` key is staged and awaiting promotion. */
  public isRotationPending(): boolean {
    return Boolean(this.next);
  }

  /**
   * True when the primary key is still accepted alongside a staged next key —
   * i.e. clients that have not migrated yet are still being served.
   */
  public isOldKeyActive(): boolean {
    return this.isRotationPending() && Boolean(this.primary);
  }

  /** ISO timestamp of the most recent rotation, or undefined if never rotated. */
  public getLastRotatedAt(): string | undefined {
    return this.lastRotatedAt;
  }

  /** Snapshot for `createAuthMiddleware`, which accepts either key. */
  public snapshot(): ApiKeyStateSnapshot {
    return { primaryKey: this.primary, nextKey: this.next };
  }

  /**
   * Atomically promote the staged `next` key to `primary` and invalidate the
   * key it replaces.
   *
   * Both assignments happen in the same synchronous block with no `await`
   * between them, so concurrent requests either see the full pre-rotation
   * state or the full post-rotation state — never a mix. After this returns,
   * the previous primary key is unreachable and every request presenting it
   * is rejected.
   *
   * @throws {NoPendingRotationError} when no `next` key is staged.
   */
  public rotate(): RotationResult {
    const promoted = this.next;

    if (!promoted) {
      throw new NoPendingRotationError();
    }

    this.primary = promoted;
    this.next = undefined;
    this.lastRotatedAt = new Date().toISOString();

    return {
      rotationPending: false,
      oldKeyActive: false,
      rotatedAt: this.lastRotatedAt,
    };
  }

  /**
   * Stage a new `next` key, replacing any key already staged.
   *
   * Used by tests and by future config-reload paths; the HTTP surface never
   * accepts key material in a request body.
   */
  public stageNextKey(nextKey: string | undefined): void {
    this.next = nextKey;
  }
}
