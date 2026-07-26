import type { BackendEnv } from "../../config/env.js";
import { createLogger } from "../../shared/logging/logger.js";
import {
  NormalizedRecurringPayment,
  RawRecurringPayment,
  RecurringCursor,
  RecurringEvent,
  RecurringFilter,
  RecurringIndexerState,
  RecurringStatus,
} from "./types.js";
import {
  isInBackoff,
  recordFailure,
  type BackoffOptions,
  type PaymentBackoffEvent,
} from "./backoff.js";

/**
 * A due payment enriched with the reason it was triggered.
 * - exact       : next_payment_ledger === current_ledger
 * - jitter_early: payment was within the jitter window before its due date
 * - jitter_late : payment is past due but within the jitter look-back window
 */
export interface DuePaymentResult {
  readonly payment: NormalizedRecurringPayment;
  readonly trigger_reason: "exact" | "jitter_early" | "jitter_late";
}

const logger = createLogger("recurring-indexer");

/**
 * Storage adapter interface for recurring payments.
 * Implement this to connect to your persistence layer.
 */
export interface RecurringStorageAdapter {
  /** Get all recurring payments (optionally filtered) */
  getAll(filter?: RecurringFilter): Promise<NormalizedRecurringPayment[]>;
  /** Get a single recurring payment by ID */
  getById(paymentId: string): Promise<NormalizedRecurringPayment | null>;
  /** Save or update a recurring payment */
  save(payment: NormalizedRecurringPayment): Promise<void>;
  /** Delete a recurring payment */
  delete(paymentId: string): Promise<void>;
  /** Get cursor for pagination */
  getCursor(): Promise<RecurringCursor | null>;
  /** Save cursor for pagination */
  saveCursor(cursor: RecurringCursor): Promise<void>;
}

/**
 * Memory-based storage adapter for development/testing.
 * Replace with a persistent adapter in production.
 */
export class MemoryRecurringStorageAdapter implements RecurringStorageAdapter {
  private payments: Map<string, NormalizedRecurringPayment> = new Map();
  private cursor: RecurringCursor | null = null;

  async getAll(
    filter?: RecurringFilter,
  ): Promise<NormalizedRecurringPayment[]> {
    let payments = Array.from(this.payments.values());

    if (filter) {
      if (filter.contractId) {
        payments = payments.filter(
          (p) => p.metadata.contractId === filter.contractId,
        );
      }
      if (filter.status) {
        payments = payments.filter((p) => p.status === filter.status);
      }
      if (filter.proposer) {
        payments = payments.filter((p) => p.proposer === filter.proposer);
      }
      if (filter.recipient) {
        payments = payments.filter((p) => p.recipient === filter.recipient);
      }
      if (filter.token) {
        payments = payments.filter((p) => p.token === filter.token);
      }
      if (filter.minPaymentLedger !== undefined) {
        payments = payments.filter(
          (p) => p.nextPaymentLedger >= filter.minPaymentLedger!,
        );
      }
      if (filter.maxPaymentLedger !== undefined) {
        payments = payments.filter(
          (p) => p.nextPaymentLedger <= filter.maxPaymentLedger!,
        );
      }
    }

    return payments;
  }

  async getById(paymentId: string): Promise<NormalizedRecurringPayment | null> {
    return this.payments.get(paymentId) ?? null;
  }

  async save(payment: NormalizedRecurringPayment): Promise<void> {
    this.payments.set(payment.paymentId, payment);
  }

  async delete(paymentId: string): Promise<void> {
    this.payments.delete(paymentId);
  }

  async getCursor(): Promise<RecurringCursor | null> {
    return this.cursor;
  }

  async saveCursor(cursor: RecurringCursor): Promise<void> {
    this.cursor = cursor;
  }
}

/**
 * Transform raw contract data to normalized recurring payment.
 */
export function transformRawRecurringPayment(
  raw: RawRecurringPayment,
  contractId: string,
  ledger: number,
  existingPayment?: NormalizedRecurringPayment,
): NormalizedRecurringPayment {
  const now = new Date().toISOString();
  const events: RecurringEvent[] = existingPayment?.events ?? [];

  const nextPaymentLedger = Number(raw.next_payment_ledger);
  const retryNextLedger = Number(raw.retry_next_ledger || "0");
  const effectiveNextLedger = Math.max(nextPaymentLedger, retryNextLedger);

  // Determine status
  let status: RecurringStatus;
  if (!raw.is_active) {
    status = RecurringStatus.CANCELLED;
    if (!events.includes(RecurringEvent.CANCELLED)) {
      events.push(RecurringEvent.CANCELLED);
    }
  } else if (effectiveNextLedger <= ledger) {
    status = RecurringStatus.DUE;
    if (!events.includes(RecurringEvent.BECAME_DUE)) {
      events.push(RecurringEvent.BECAME_DUE);
    }
  } else {
    status = RecurringStatus.ACTIVE;
  }

  // Add CREATED event if this is new
  if (!existingPayment) {
    events.unshift(RecurringEvent.CREATED);
  }

  // Check if executed (payment count increased)
  if (
    existingPayment &&
    Number(raw.payment_count) > existingPayment.paymentCount
  ) {
    if (!events.includes(RecurringEvent.EXECUTED)) {
      events.push(RecurringEvent.EXECUTED);
    events.push(RecurringEvent.EXECUTED);
    // If jitter is configured and this payment is past its first cycle, the
    // contract will have emitted a recurring_pay_jittered event on-chain.
    // Mirror that in the local event log for audit-trail completeness.
    if (Number(raw.jitter_window ?? "0") > 0 && Number(raw.payment_count) > 1) {
      if (!events.includes(RecurringEvent.JITTERED)) {
        events.push(RecurringEvent.JITTERED);
      }
    }
  }

  // Calculate computed fields
  const currentLedger = ledger;
  const interval = Number(raw.interval);

  let computedStatus: "active" | "paused" | "stopped" | "overdue" = "active";
  let ledgersUntilDue = effectiveNextLedger - currentLedger;
  let missedPayments = 0;

  if (!raw.is_active) {
    computedStatus = "stopped";
    ledgersUntilDue = 0;
    missedPayments = 0;
  } else if (effectiveNextLedger < currentLedger) {
    computedStatus = "overdue";
    // Calculate missed payments: floor((currentLedger - effectiveNextLedger) / interval)
    missedPayments = Math.floor((currentLedger - effectiveNextLedger) / interval);
  } else if (effectiveNextLedger === currentLedger) {
    computedStatus = "active";
  } else {
    computedStatus = "active";
  }

  const retryStrategyRaw = raw.retry_strategy?.toString() ?? "1";
  const retryStrategy =
    retryStrategyRaw === "0" || retryStrategyRaw.toUpperCase() === "LINEAR"
      ? "LINEAR"
      : "EXPONENTIAL";
  // Detect a new successful execution (payment_count increased).
  // Used both to push the EXECUTED event and to reset retry state.
  const wasExecuted =
    existingPayment !== undefined &&
    Number(raw.payment_count) > existingPayment.paymentCount;

  if (wasExecuted) {
    events.push(RecurringEvent.EXECUTED);
  }

  // Preserve existing retry state; reset to zero on successful execution.

  const retryCount = wasExecuted ? 0 : (existingPayment?.retryCount ?? 0);
  const lastAttemptAt = wasExecuted ? 0 : (existingPayment?.lastAttemptAt ?? 0);
  const nextRetryAt = wasExecuted ? 0 : (existingPayment?.nextRetryAt ?? 0);

  return {
    paymentId: raw.id,
    proposer: raw.proposer,
    recipient: raw.recipient,
    token: raw.token,
    amount: raw.amount,
    memo: raw.memo,
    intervalLedgers: Number(raw.interval),
    nextPaymentLedger: nextPaymentLedger,
    retryStrategy,
    retryCount: Number(raw.retry_count || "0"),
    retryNextLedger: retryNextLedger,
    paymentCount: Number(raw.payment_count),
    status,
    events,
    metadata: {
      id: raw.id,
      contractId,
      createdAt: existingPayment?.metadata.createdAt ?? now,
      lastUpdatedAt: now,
      ledger,
    },
    computedStatus,
    ledgersUntilDue,
    missedPayments,
    retryCount,
    lastAttemptAt,
    nextRetryAt,
    // Jitter fields — default to 0 for payments created before jitter support
    // or when not returned by the RPC (optional in RawRecurringPayment).
    jitterWindow: Number(raw.jitter_window ?? "0"),
    jitterOffset: Number(raw.jitter_offset ?? "0"),
  };
}

/**
 * RecurringPaymentIndexerService
 *
 * A background service that indexes recurring payment states from the contract.
 * Supports automation triggers, reminders, and reporting.
 */
export class RecurringIndexerService {
  private isRunning: boolean = false;
  private syncInProgress: boolean = false;
  private timer: NodeJS.Timeout | null = null;
  private lastLedgerProcessed: number = 0;
  private consecutiveErrors: number = 0;
  private totalPaymentsIndexed: number = 0;
  /** Tracks payment IDs already alerted to avoid duplicate warn logs/callbacks. */
  private readonly alertedIds = new Set<string>();

  constructor(
    private readonly env: BackendEnv,
    private readonly storage: RecurringStorageAdapter,
    private readonly onPaymentDue?: (
      payment: NormalizedRecurringPayment,
    ) => void,
  ) {}

  /**
   * Seeds alertedIds with payments already in DUE status so they don't
   * re-trigger alerts when the service starts.
   */
  private async seedAlertedIds(): Promise<void> {
    const existing = await this.storage.getAll({ status: RecurringStatus.DUE });
    for (const p of existing) {
      this.alertedIds.add(p.paymentId);
    }
  }

  /**
   * Starts the indexing loop if enabled in config.
   */
  public async start(): Promise<void> {
    if (this.isRunning) return;
    if (!this.env.eventPollingEnabled) {
      console.log("[recurring-indexer] disabled in config");
      return;
    }

    // Load last cursor from storage
    const lastCursor = await this.storage.getCursor();
    if (lastCursor) {
      this.lastLedgerProcessed = lastCursor.lastLedger;
      this.totalPaymentsIndexed = (await this.storage.getAll()).length;
      console.log(
        `[recurring-indexer] resuming from cursor: ledger ${this.lastLedgerProcessed}`,
      );
    } else {
      this.lastLedgerProcessed = 0;
      console.log("[recurring-indexer] no cursor found, starting fresh");
    }

    this.isRunning = true;
    console.log("[recurring-indexer] starting indexer loop");
    console.log(`- rpc: ${this.env.sorobanRpcUrl}`);
    console.log(`- contract: ${this.env.contractId}`);
    console.log(`- interval: ${this.env.eventPollingIntervalMs}ms`);

    // Seed alerted IDs so pre-existing DUE payments don't re-trigger alerts.
    await this.seedAlertedIds();

    this.scheduleNextSync();
  }

  /**
   * Gracefully stops the indexing loop.
   */
  public stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log("[recurring-indexer] stopped indexer loop");
  }

  private scheduleNextSync(): void {
    if (!this.isRunning) return;

    let delayMs = this.env.eventPollingIntervalMs;
    if (this.consecutiveErrors > 0) {
      const MAX_BACKOFF_MS = 5 * 60 * 1000;
      const backoff = delayMs * Math.pow(2, this.consecutiveErrors);
      delayMs = Math.min(backoff, MAX_BACKOFF_MS);
      console.log(`[recurring-indexer] backing off for ${delayMs}ms`);
    }

    this.timer = setTimeout(async () => {
      if (!this.isRunning) return;

      try {
        await this.sync();
        this.consecutiveErrors = 0;
      } catch (error) {
        this.consecutiveErrors++;
        console.error(
          `[recurring-indexer] sync error (attempt ${this.consecutiveErrors}):`,
          error,
        );
      } finally {
        this.scheduleNextSync();
      }
    }, delayMs);
  }

  /**
   * Performs a sync cycle: fetches recurring payments and updates index.
   */
  public async sync(): Promise<void> {
    this.syncInProgress = true;
    try {
      // TODO: Implement RPC call to fetch recurring payments
      // const payments = await this.rpcService.getRecurringPayments({
      //   offset: 0,
      //   limit: 100,
      // });

      // Placeholder for development
      const mockPayments: RawRecurringPayment[] = [];

      if (mockPayments.length > 0) {
        await this.indexPayments(mockPayments);
      }

      this.lastLedgerProcessed += 1;

      // Persist cursor
      await this.storage.saveCursor({
        lastId: "",
        lastLedger: this.lastLedgerProcessed,
        updatedAt: new Date().toISOString(),
      });
    } finally {
      this.syncInProgress = false;
    }
  }

  /** Returns true if a sync cycle is currently in progress. */
  public isSyncing(): boolean {
    return this.syncInProgress;
  }

  /**
   * Indexes a batch of recurring payments.
   */
  private async indexPayments(payments: RawRecurringPayment[]): Promise<void> {
    console.log(`[recurring-indexer] indexing ${payments.length} payments`);

    for (const raw of payments) {
      const existing = await this.storage.getById(raw.id);
      const normalized = transformRawRecurringPayment(
        raw,
        this.env.contractId,
        this.lastLedgerProcessed,
        existing ?? undefined,
      );
      await this.storage.save(normalized);
      this.totalPaymentsIndexed++;

      // Emit alert on first transition to DUE — not on every sync.
      if (
        normalized.status === RecurringStatus.DUE &&
        !this.alertedIds.has(normalized.paymentId)
      ) {
        this.alertedIds.add(normalized.paymentId);
        logger.warn("recurring payment is due", {
          paymentId: normalized.paymentId,
          recipient: normalized.recipient,
          amount: normalized.amount,
          token: normalized.token,
        });
        this.onPaymentDue?.(normalized);
      }
    }
  }

  /**
   * Manually sync a single payment by ID.
   * Falls back to storage when the RPC client is available; until then throws.
   */
  public async syncPayment(
    paymentId: string,
  ): Promise<NormalizedRecurringPayment | null> {
    // TODO: replace with RPC fetch once SorobanRpcClient is wired up:
    // const raw = await this.rpcService.getRecurringPayment(paymentId);
    // if (!raw) return null;
    // const normalized = transformRawRecurringPayment(raw, this.env.contractId, this.lastLedgerProcessed);
    // await this.storage.save(normalized);
    // return normalized;

    // RPC client not yet available — fall back to storage index.
    const stored = await this.storage.getById(paymentId);
    if (stored !== null) return stored;

    throw new Error("syncPayment: RPC client not yet available");
  }

  /**
   * Get paginated indexed payments with optional filtering.
   * Enriches payments with computed status fields using current ledger.
   */
  public async getPayments(
    filter?: RecurringFilter,
    pagination?: { offset: number; limit: number },
    currentLedger?: number,
  ): Promise<{
    items: NormalizedRecurringPayment[];
    total: number;
    offset: number;
    limit: number;
  }> {
    let all = await this.storage.getAll(filter);

    // Enrich payments with computed status if current ledger is provided
    if (currentLedger !== undefined) {
      all = all.map((payment) => {
        // Calculate computed fields based on current ledger
        const nextPaymentLedger = payment.nextPaymentLedger;
        const interval = payment.intervalLedgers;

        const effectiveLedger = Math.max(payment.nextPaymentLedger, payment.retryNextLedger);
        let computedStatus: "active" | "paused" | "stopped" | "overdue" =
          "active";
        let ledgersUntilDue = effectiveLedger - currentLedger;
        let missedPayments = 0;

        if (!payment.status || payment.status === RecurringStatus.CANCELLED) {
          computedStatus = "stopped";
        } else if (effectiveLedger < currentLedger) {
          computedStatus = "overdue";
          // Calculate missed payments: floor((currentLedger - effectiveLedger) / interval)
          missedPayments = Math.floor(
            (currentLedger - effectiveLedger) / interval,
          );
        } else if (effectiveLedger === currentLedger) {
          computedStatus = "active";
        } else {
          computedStatus = "active";
        }

        return {
          ...payment,
          computedStatus,
          ledgersUntilDue,
          missedPayments,
        };
      });
    }

    const offset = pagination?.offset ?? 0;
    const limit = pagination?.limit ?? 50;
    return {
      items: all.slice(offset, offset + limit),
      total: all.length,
      offset,
      limit,
    };
  }

  /**
   * Get a single payment by ID.
   */
  public async getPayment(
    paymentId: string,
  ): Promise<NormalizedRecurringPayment | null> {
    return this.storage.getById(paymentId);
  }

  /**
   * Get all payments that are currently due.
   */
  public async getDuePayments(): Promise<NormalizedRecurringPayment[]> {
    return this.storage.getAll({ status: RecurringStatus.DUE });
  }

  /**
   * Get payments that are ready for execution at a specific ledger.
   * (Exact match — legacy method retained for backward compatibility.)
   */
  public async getDuePaymentsAtLedger(
    currentLedger: number,
  ): Promise<NormalizedRecurringPayment[]> {
    const all = await this.storage.getAll();
    return all.filter((payment) => {
      const effectiveLedger = Math.max(
        payment.nextPaymentLedger,
        payment.retryNextLedger ?? 0,
      );
      return payment.status !== RecurringStatus.CANCELLED && effectiveLedger <= currentLedger;
    });
  }

  /**
   * Get payments due within a ledger window to account for on-chain jitter.
   *
   * Window: [currentLedger - jitterWindowMax, currentLedger + 1]
   *
   * Returns DuePaymentResult entries with a trigger_reason indicating
   * whether the payment was triggered exactly on time, early (jitter_early),
   * or late (jitter_late).
   *
   * @param currentLedger  - Current on-chain ledger
   * @param jitterWindowMax - Width of the jitter look-back/ahead window
   */
  public async getDuePaymentsInWindow(
    currentLedger: number,
    jitterWindowMax: number,
  ): Promise<DuePaymentResult[]> {
    const windowStart = currentLedger - jitterWindowMax;
    const windowEnd = currentLedger + 1; // inclusive upper bound
    const nowSeconds = Math.floor(Date.now() / 1000);

    const all = await this.storage.getAll();
    const inWindow = all.filter((payment) => {
      if (payment.status === RecurringStatus.CANCELLED) {
        return false;
      }
      const effectiveLedger = Math.max(
        payment.nextPaymentLedger,
        payment.retryNextLedger ?? 0,
      );
      return effectiveLedger >= windowStart && effectiveLedger <= windowEnd;
    });
    const inWindow = all.filter(
      (payment) =>
        payment.status !== RecurringStatus.CANCELLED &&
        payment.nextPaymentLedger >= windowStart &&
        payment.nextPaymentLedger <= windowEnd &&
        // Skip payments that are still within their backoff window.
        // This is the guard that eliminates the tight-polling loop when
        // a vault balance issue causes repeated failures.
        !isInBackoff(
          {
            retryCount: payment.retryCount,
            lastAttemptAt: payment.lastAttemptAt,
            nextRetryAt: payment.nextRetryAt,
          },
          nowSeconds,
        ),
    );

    return inWindow.map((payment) => {
      const effectiveLedger = Math.max(payment.nextPaymentLedger, payment.retryNextLedger);
      let trigger_reason: DuePaymentResult["trigger_reason"];
      if (effectiveLedger === currentLedger) {
        trigger_reason = "exact";
      } else if (effectiveLedger > currentLedger) {
        trigger_reason = "jitter_early";
      } else {
        trigger_reason = "jitter_late";
      }
      return { payment, trigger_reason };
    });
  }

  /**
   * Get all active payments.
   */
  public async getActivePayments(): Promise<NormalizedRecurringPayment[]> {
    return this.storage.getAll({ status: RecurringStatus.ACTIVE });
  }

  /**
   * Get all cancelled payments.
   */
  public async getCancelledPayments(): Promise<NormalizedRecurringPayment[]> {
    return this.storage.getAll({ status: RecurringStatus.CANCELLED });
  }

  /**
   * Check for conflicting recurring payments based on similarity criteria:
   * - Same recipient AND same amount (within 5% tolerance) AND overlapping interval
   *
   * Returns conflicts sorted by similarity score descending (100 = exact match).
   * Runs in-memory in < 50ms against active payments.
   */
  public async checkConflicts(params: {
    recipient: string;
    amount: string;
    intervalLedgers: number;
  }): Promise<Array<{ id: string; similarity_score: number; description: string }>> {
    const actives = await this.storage.getAll({ status: RecurringStatus.ACTIVE });
    const conflicts: Array<{ id: string; similarity_score: number; description: string }> = [];

    const proposedAmount = Number(params.amount);

    for (const payment of actives) {
      if (payment.recipient !== params.recipient) continue;

      const existingAmount = Number(payment.amount);
      const amountDiff = Math.abs(existingAmount - proposedAmount) / (proposedAmount || 1);
      if (amountDiff > 0.05) continue;

      // Check overlapping interval: intervals overlap if they share any execution window
      // Simplified: intervals overlap when they are equal or one divides the other
      const intervalOverlap =
        payment.intervalLedgers === params.intervalLedgers ||
        params.intervalLedgers % payment.intervalLedgers === 0 ||
        payment.intervalLedgers % params.intervalLedgers === 0;
      if (!intervalOverlap) continue;

      // Compute similarity score 0-100
      const amountScore = Math.round((1 - amountDiff) * 50);
      const intervalScore = payment.intervalLedgers === params.intervalLedgers ? 50 : 25;
      const similarity_score = amountScore + intervalScore;

      conflicts.push({
        id: payment.paymentId,
        similarity_score,
        description: `Existing payment to ${payment.recipient} for ${payment.amount} every ${payment.intervalLedgers} ledgers`,
      });
    }

    return conflicts.sort((a, b) => b.similarity_score - a.similarity_score);
  }

  /**
   * Record a failed execution attempt for a payment and persist the updated
   * backoff state.  Returns the `PaymentBackoffEvent` that callers should
   * emit/log so observers can track retry progression.
   *
   * Call this from the keeper job whenever a payment execution fails.  The
   * scheduler will automatically skip the payment until `nextRetryAt` has
   * elapsed (via the `isInBackoff` guard in `getDuePaymentsInWindow`).
   *
   * @param paymentId  - ID of the recurring payment that failed.
   * @param options    - Backoff strategy and base-delay overrides.
   * @returns The backoff event data, or null if the payment is not found.
   */
  public async recordPaymentFailure(
    paymentId: string,
    options: BackoffOptions = {},
  ): Promise<PaymentBackoffEvent | null> {
    const payment = await this.storage.getById(paymentId);
    if (!payment) return null;

    const nowSeconds = Math.floor(Date.now() / 1000);
    const { state, event } = recordFailure(
      paymentId,
      {
        retryCount: payment.retryCount,
        lastAttemptAt: payment.lastAttemptAt,
        nextRetryAt: payment.nextRetryAt,
      },
      nowSeconds,
      options,
    );

    await this.storage.save({
      ...payment,
      retryCount: state.retryCount,
      lastAttemptAt: state.lastAttemptAt,
      nextRetryAt: state.nextRetryAt,
    });

    return event;
  }

  /**
   * Returns current indexer state for health monitoring.
   */
  public getStatus(): RecurringIndexerState {
    return {
      lastLedgerProcessed: this.lastLedgerProcessed,
      isIndexing: this.isRunning,
      totalPaymentsIndexed: this.totalPaymentsIndexed,
      errors: this.consecutiveErrors,
    };
  }
}
