/**
 * Keeper fencing tokens (Issue #2225).
 *
 * A fence is a short-lived, monotonically numbered lease keyed by the payment
 * and its due ledger. Two keepers may both observe the same due payment, but
 * only the keeper holding the current token may publish/enqueue the trigger.
 * A stale keeper that lost its lease cannot publish because `validate` compares
 * the fencing token it was given with the token currently stored.
 */

export interface KeeperFenceLease {
  readonly key: string;
  readonly token: number;
  readonly owner: string;
  readonly expiresAt: number;
}

export class KeeperFence {
  private readonly leases = new Map<string, KeeperFenceLease>();
  private nextToken = 1;

  /** Try to acquire the lease. Returns a fencing token, or `null` if fenced. */
  tryAcquire(
    key: string,
    owner: string,
    ttlMs: number,
    now: number = Date.now(),
  ): KeeperFenceLease | null {
    const current = this.leases.get(key);
    if (current && current.expiresAt > now) return null;

    const lease: KeeperFenceLease = {
      key,
      token: this.nextToken++,
      owner,
      expiresAt: now + ttlMs,
    };
    this.leases.set(key, lease);
    return lease;
  }

  /** True only while the caller still owns the latest token for this key. */
  validate(key: string, token: number, now: number = Date.now()): boolean {
    const current = this.leases.get(key);
    return Boolean(current && current.token === token && current.expiresAt > now);
  }

  /** Release exactly once: an old owner cannot release a newer lease. */
  release(key: string, token: number): boolean {
    const current = this.leases.get(key);
    if (!current || current.token !== token) return false;
    this.leases.delete(key);
    return true;
  }

  /** Remove expired leases; safe to call from the keeper loop. */
  evictExpired(now: number = Date.now()): void {
    for (const [key, lease] of this.leases) {
      if (lease.expiresAt <= now) this.leases.delete(key);
    }
  }

  activeLeases(): number {
    return this.leases.size;
  }
}
