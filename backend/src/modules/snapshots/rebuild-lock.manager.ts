/**
 * Rebuild Lock Manager
 *
 * Provides distributed locking to prevent concurrent snapshot rebuilds.
 * Supports multiple lock backends (Redis, in-memory).
 */

import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createLogger } from "../../shared/logging/logger.js";

/**
 * Lock state for a contract.
 */
interface LockEntry {
  readonly contractId: string;
  readonly acquiredAt: number;
  readonly expiresAt: number;
  readonly lockId: string;
}

/**
 * Lock acquisition result.
 */
export interface LockAcquisitionResult {
  readonly acquired: boolean;
  readonly lockId?: string;
  readonly expiresAt?: number;
  readonly holdBy?: string;
}

/**
 * Lock release result.
 */
export interface LockReleaseResult {
  readonly released: boolean;
}

/**
 * Abstract lock backend.
 */
export interface LockBackend {
  /**
   * Attempt to acquire a lock for the given contract ID.
   * Returns true if acquired, false if already held.
   * Lock duration is specified in milliseconds.
   */
  tryAcquire(
    contractId: string,
    durationMs: number,
  ): Promise<LockAcquisitionResult>;

  /**
   * Release a lock by ID.
   * Returns true if released, false if already released or held by different owner.
   */
  release(contractId: string, lockId: string): Promise<LockReleaseResult>;

  /**
   * Check if a lock is currently held.
   */
  isLocked(contractId: string): Promise<boolean>;
}

export interface RedisLockClient {
  set(key: string, value: string, expiryMode: "PX", durationMs: number, condition: "NX"): Promise<"OK" | null>;
  eval(script: string, numberOfKeys: number, key: string, lockId: string): Promise<number>;
  exists(key: string): Promise<number>;
}

/**
 * Redis-backed lease lock. Release is compare-and-delete so an expired owner
 * cannot release a lease acquired by another worker.
 */
export class RedisLockBackend implements LockBackend {
  constructor(
    private readonly redis: RedisLockClient,
    private readonly keyPrefix = "vaultdao:snapshot-lock:",
  ) {}

  async tryAcquire(contractId: string, durationMs: number): Promise<LockAcquisitionResult> {
    if (!Number.isInteger(durationMs) || durationMs <= 0) {
      throw new Error("Lock duration must be a positive integer");
    }
    const lockId = `lock:${contractId}:${randomUUID()}`;
    const key = this.keyPrefix + contractId;
    const acquired = await this.redis.set(key, lockId, "PX", durationMs, "NX");
    return acquired === "OK"
      ? { acquired: true, lockId, expiresAt: Date.now() + durationMs }
      : { acquired: false };
  }

  async release(contractId: string, lockId: string): Promise<LockReleaseResult> {
    const released = await this.redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      this.keyPrefix + contractId,
      lockId,
    );
    return { released: released === 1 };
  }

  async isLocked(contractId: string): Promise<boolean> {
    return (await this.redis.exists(this.keyPrefix + contractId)) === 1;
  }
}

/**
 * Persistent lease lock backed by a shared SQLite database file. BEGIN
 * IMMEDIATE serializes acquisitions across backend processes using that file.
 */
export class SqliteLockBackend implements LockBackend {
  constructor(
    private readonly db: DatabaseSync,
    private readonly keyPrefix = "snapshot:",
  ) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS snapshot_locks (
        lock_key TEXT PRIMARY KEY,
        lock_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `);
  }

  async tryAcquire(contractId: string, durationMs: number): Promise<LockAcquisitionResult> {
    if (!Number.isInteger(durationMs) || durationMs <= 0) {
      throw new Error("Lock duration must be a positive integer");
    }
    const now = Date.now();
    const lockId = `lock:${contractId}:${randomUUID()}`;
    const lockKey = this.keyPrefix + contractId;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM snapshot_locks WHERE lock_key = ? AND expires_at <= ?")
        .run(lockKey, now);
      const result = this.db.prepare(`
        INSERT INTO snapshot_locks (lock_key, lock_id, expires_at) VALUES (?, ?, ?)
        ON CONFLICT(lock_key) DO NOTHING
      `).run(lockKey, lockId, now + durationMs);
      this.db.exec("COMMIT");
      return Number(result.changes) === 1
        ? { acquired: true, lockId, expiresAt: now + durationMs }
        : { acquired: false };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async release(contractId: string, lockId: string): Promise<LockReleaseResult> {
    const result = this.db.prepare(
      "DELETE FROM snapshot_locks WHERE lock_key = ? AND lock_id = ?",
    ).run(this.keyPrefix + contractId, lockId);
    return { released: Number(result.changes) === 1 };
  }

  async isLocked(contractId: string): Promise<boolean> {
    const now = Date.now();
    const lockKey = this.keyPrefix + contractId;
    this.db.prepare("DELETE FROM snapshot_locks WHERE lock_key = ? AND expires_at <= ?")
      .run(lockKey, now);
    return Boolean(this.db.prepare(
      "SELECT 1 AS held FROM snapshot_locks WHERE lock_key = ?",
    ).get(lockKey));
  }
}

/**
 * In-memory lock backend for single-instance deployments.
 */
export class InMemoryLockBackend implements LockBackend {
  private locks = new Map<string, LockEntry>();
  private readonly logger = createLogger("lock-backend-memory");

  async tryAcquire(
    contractId: string,
    durationMs: number,
  ): Promise<LockAcquisitionResult> {
    const now = Date.now();
    const existing = this.locks.get(contractId);

    if (existing && existing.expiresAt > now) {
      // Lock is still valid
      return {
        acquired: false,
        holdBy: existing.lockId,
        expiresAt: existing.expiresAt,
      };
    }

    // Acquire new lock
    const lockId = `lock:${contractId}:${now}:${randomUUID()}`;
    const expiresAt = now + durationMs;

    this.locks.set(contractId, {
      contractId,
      acquiredAt: now,
      expiresAt,
      lockId,
    });

    this.logger.debug("lock acquired", { contractId, lockId, expiresAt });

    return {
      acquired: true,
      lockId,
      expiresAt,
    };
  }

  async release(
    contractId: string,
    lockId: string,
  ): Promise<LockReleaseResult> {
    const existing = this.locks.get(contractId);

    if (!existing || existing.lockId !== lockId) {
      return { released: false };
    }

    this.locks.delete(contractId);
    this.logger.debug("lock released", { contractId, lockId });

    return { released: true };
  }

  async isLocked(contractId: string): Promise<boolean> {
    const existing = this.locks.get(contractId);
    if (!existing) return false;

    const now = Date.now();
    const isValid = existing.expiresAt > now;

    if (!isValid) {
      this.locks.delete(contractId);
      return false;
    }

    return true;
  }
}

/**
 * SnapshotRebuildLockManager
 *
 * Manages locks for concurrent rebuild prevention.
 * Emits events on lock acquisition and release.
 */
export class SnapshotRebuildLockManager {
  private readonly logger = createLogger("rebuild-lock-manager");
  private readonly backend: LockBackend;
  private readonly defaultTimeoutMs: number;
  private lockAcquiredCallbacks: Array<(contractId: string) => void> = [];
  private lockReleasedCallbacks: Array<(contractId: string) => void> = [];

  constructor(options?: {
    backend?: LockBackend;
    defaultTimeoutMs?: number;
  }) {
    this.backend = options?.backend ?? new InMemoryLockBackend();
    this.defaultTimeoutMs = options?.defaultTimeoutMs ?? 30 * 60 * 1000; // 30 minutes default
  }

  /**
   * Attempt to acquire rebuild lock for a contract.
   * Returns lock ID if successful, or null if already locked.
   */
  async acquireLock(contractId: string): Promise<string | null> {
    const result = await this.backend.tryAcquire(
      contractId,
      this.defaultTimeoutMs,
    );

    if (!result.acquired) {
      this.logger.warn("rebuild lock not acquired", {
        contractId,
        heldBy: result.holdBy,
      });
      return null;
    }

    this.logger.info("rebuild lock acquired", {
      contractId,
      lockId: result.lockId,
    });

    // Emit event
    for (const callback of this.lockAcquiredCallbacks) {
      callback(contractId);
    }

    return result.lockId ?? null;
  }

  /**
   * Release a rebuild lock by ID.
   * Returns true if released, false otherwise.
   */
  async releaseLock(contractId: string, lockId: string): Promise<boolean> {
    const result = await this.backend.release(contractId, lockId);

    if (!result.released) {
      this.logger.warn("rebuild lock release failed", { contractId, lockId });
      return false;
    }

    this.logger.info("rebuild lock released", { contractId, lockId });

    // Emit event
    for (const callback of this.lockReleasedCallbacks) {
      callback(contractId);
    }

    return true;
  }

  /**
   * Check if a contract is currently locked for rebuild.
   */
  async isLocked(contractId: string): Promise<boolean> {
    return this.backend.isLocked(contractId);
  }

  /**
   * Register callback to be invoked when lock is acquired.
   */
  public onLockAcquired(callback: (contractId: string) => void): void {
    this.lockAcquiredCallbacks.push(callback);
  }

  /**
   * Register callback to be invoked when lock is released.
   */
  public onLockReleased(callback: (contractId: string) => void): void {
    this.lockReleasedCallbacks.push(callback);
  }
}
