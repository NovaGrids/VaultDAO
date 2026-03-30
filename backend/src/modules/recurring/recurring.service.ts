import type { BackendEnv } from "../../config/env.js";
import {
  NormalizedRecurringPayment,
  RawRecurringPayment,
  RecurringCursor,
  RecurringEvent,
  RecurringFilter,
  RecurringIndexerState,
  RecurringStatus,
} from "./types.js";

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

  // Determine status
  let status: RecurringStatus;
  if (!raw.is_active) {
    status = RecurringStatus.CANCELLED;
    if (!events.includes(RecurringEvent.CANCELLED)) {
      events.push(RecurringEvent.CANCELLED);
    }
  } else if (Number(raw.next_payment_ledger) <= ledger) {
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
    events.push(RecurringEvent.EXECUTED);
  }

  return {
    paymentId: raw.id,
    proposer: raw.proposer,
    recipient: raw.recipient,
    token: raw.token,
    amount: raw.amount,
    memo: raw.memo,
    intervalLedgers: Number(raw.interval),
    nextPaymentLedger: Number(raw.next_payment_ledger),
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
  private timer: NodeJS.Timeout | null = null;
  private lastLedgerProcessed: number = 0;
  private consecutiveErrors: number = 0;
  private totalPaymentsIndexed: number = 0;

  constructor(
    private readonly env: BackendEnv,
    private readonly storage: RecurringStorageAdapter,
  ) {}

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
    }
  }

  /**
   * Manually sync a single payment by ID.
   */
  public async syncPayment(
    _paymentId: string,
  ): Promise<NormalizedRecurringPayment | null> {
    // TODO: Implement RPC call to get specific payment
    // const raw = await this.rpcService.getRecurringPayment(_paymentId);
    // if (!raw) return null;
    // const normalized = transformRawRecurringPayment(raw, this.env.contractId, ...);
    // await this.storage.save(normalized);
    // return normalized;
    return null;
  }

  /**
   * Get paginated indexed payments with optional filtering.
   */
  public async getPayments(
    filter?: RecurringFilter,
    pagination?: { offset: number; limit: number },
  ): Promise<{
    items: NormalizedRecurringPayment[];
    total: number;
    offset: number;
    limit: number;
  }> {
    const all = await this.storage.getAll(filter);
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
