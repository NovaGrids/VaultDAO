/**
 * Proposal Event Consumer
 *
 * Consumes normalized events and transforms them into proposal activity records.
 * This is the main entry point for the proposal indexing service.
 */

import { createLogger } from "../../shared/logging/logger.js";
import type { NormalizedEvent } from "../events/types.js";
import { ProposalEventTransformer, transformEventBatch } from "./transforms.js";
import {
  ProposalActivityRecord,
  ProposalEventConsumer,
  ProposalBatchConsumer,
  ProposalActivityPersistence,
} from "./types.js";

/**
 * Default batch size for consumer buffering.
 */
const DEFAULT_BATCH_SIZE = 100;

/**
 * Default flush interval in milliseconds.
 */
const DEFAULT_FLUSH_INTERVAL_MS = 5000;

/**
 * ProposalActivityConsumer
 *
 * Main consumer class that processes normalized events and produces
 * proposal activity records. Supports batch processing for efficiency.
 */
export class ProposalActivityConsumer {
  private readonly logger = createLogger("proposal-consumer");
  private buffer: ProposalActivityRecord[] = [];
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private consumers: ProposalEventConsumer[] = [];
  private batchConsumers: ProposalBatchConsumer[] = [];
  private persistence: ProposalActivityPersistence | null = null;
  private isRunning: boolean = false;
  private isFlushing: boolean = false;
  private pendingFlush: boolean = false;

  // Persistence failure tracking
  private retryBuffer: ProposalActivityRecord[] = [];
  private failureCount: number = 0;
  private nextRetryTime: number = 0;
  private readonly maxRetries: number;
  private readonly initialBackoffMs: number;

  constructor(options?: {
    batchSize?: number;
    flushIntervalMs?: number;
    maxRetries?: number;
    initialBackoffMs?: number;
  }) {
    this.batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE;
    this.flushIntervalMs =
      options?.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.maxRetries = options?.maxRetries ?? 5;
    this.initialBackoffMs = options?.initialBackoffMs ?? 1000;
  }

  /**
   * Starts the consumer's periodic flush timer.
   */
  public start(): void {
    if (this.isRunning) {
      this.logger.debug("already running");
      return;
    }

    this.isRunning = true;
    this.startFlushTimer();
    this.logger.debug("started");
  }

  /**
   * Stops the consumer and flushes remaining records.
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    this.stopFlushTimer();
    // Final flush attempt for everything including retry buffer
    await this.flush();
    this.logger.debug("stopped");
  }

  /**
   * Registers a single-record consumer callback.
   */
  public registerConsumer(consumer: ProposalEventConsumer): void {
    this.consumers.push(consumer);
  }

  /**
   * Registers a batch consumer callback.
   */
  public registerBatchConsumer(consumer: ProposalBatchConsumer): void {
    this.batchConsumers.push(consumer);
  }

  /**
   * Sets the persistence adapter for storing records.
   */
  public setPersistence(persistence: ProposalActivityPersistence): void {
    this.persistence = persistence;
  }

  /**
   * Returns whether the consumer is currently running.
   */
  public getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Processes a single normalized event.
   */
  public async process(event: NormalizedEvent): Promise<void> {
    const record = ProposalEventTransformer.transform(event);

    if (!record) {
      console.debug(
        "[proposal-consumer] skipped non-proposal event:",
        event.type,
      );
      return;
    }

    this.buffer.push(record);
    console.debug("[proposal-consumer] buffered record:", record.activityId);

    // Notify single consumers immediately
    for (const consumer of this.consumers) {
      try {
        await consumer(record);
      } catch (error) {
        console.error("[proposal-consumer] consumer error:", error);
      }
    }

    // Check if we should flush
    if (this.buffer.length >= this.batchSize) {
      await this.flush();
    }
  }

  /**
   * Processes multiple normalized events in batch.
   */
  public async processBatch(events: NormalizedEvent[]): Promise<void> {
    const records = transformEventBatch(events);

    if (records.length === 0) {
      console.debug("[proposal-consumer] no proposal events in batch");
      return;
    }

    this.buffer.push(...records);
    console.debug(
      "[proposal-consumer] buffered",
      records.length,
      "records from batch",
    );

    // Notify batch consumers
    for (const consumer of this.batchConsumers) {
      try {
        await consumer(records);
      } catch (error) {
        console.error("[proposal-consumer] batch consumer error:", error);
      }
    }

    // Check if we should flush
    if (this.buffer.length >= this.batchSize) {
      await this.flush();
    }
  }

  /**
   * Flushes the buffer to persistence and notifies all consumers.
   * Concurrent calls are serialized via isFlushing/pendingFlush flags:
   * if a flush is already in progress the caller sets pendingFlush and
   * returns immediately; the active flush will re-run once it finishes.
   */
  public async flush(): Promise<void> {
    if (this.isFlushing) {
      this.pendingFlush = true;
      return;
    }

    if (this.buffer.length === 0 && this.retryBuffer.length === 0) {
      return;
    }

    this.isFlushing = true;

    try {
      const now = Date.now();

      // 1. Handle previously failed records if backoff has expired
      if (this.retryBuffer.length > 0 && now >= this.nextRetryTime) {
        const retryRecords = [...this.retryBuffer];
        console.debug(
          "[proposal-consumer] retrying persistence for",
          retryRecords.length,
          "records (attempt",
          this.failureCount + 1,
          ")",
        );

        if (this.persistence) {
          try {
            await this.persistence.saveBatch(retryRecords);
            console.debug(
              "[proposal-consumer] successfully persisted retry batch",
            );
            this.retryBuffer = [];
            this.failureCount = 0;
            this.nextRetryTime = 0;
          } catch (error) {
            this.failureCount++;
            if (this.failureCount >= this.maxRetries) {
              console.error(
                "[proposal-consumer] CRITICAL: max retries reached. Dropping",
                this.retryBuffer.length,
                "records.",
              );
              this.retryBuffer = [];
              this.failureCount = 0;
              this.nextRetryTime = 0;
            } else {
              const backoff =
                this.initialBackoffMs * Math.pow(2, this.failureCount - 1);
              this.nextRetryTime = now + backoff;
              console.warn(
                `[proposal-consumer] persistence retry failed. Next retry in ${backoff}ms`,
              );
            }
          }
        }
      }

      // 2. Handle new records
      if (this.buffer.length > 0) {
        const records = [...this.buffer];
        this.buffer = [];

        console.debug(
          "[proposal-consumer] flushing",
          records.length,
          "new records",
        );

        // Save to persistence if configured
        if (this.persistence) {
          try {
            await this.persistence.saveBatch(records);
            console.debug(
              "[proposal-consumer] persisted",
              records.length,
              "new records",
            );
          } catch (error) {
            console.error(
              "[proposal-consumer] persistence error for new records:",
              error,
            );
            // Move new records to retry buffer and initiate backoff if not already set
            this.retryBuffer.push(...records);
            if (this.failureCount === 0) {
              this.failureCount = 1;
              this.nextRetryTime = now + this.initialBackoffMs;
              console.warn(
                `[proposal-consumer] initiated backoff. Next retry in ${this.initialBackoffMs}ms`,
              );
            }
          }
        }

        // Notify batch consumers for successfully processed records
        // Actually, we should probably only notify if they were successfully persisted?
        // Current implementation notifies batch consumers AFTER try-catch block for persistence.
        // Wait, if persistence.saveBatch throws, current implementation unshifts and RETHROWS.
        // In my new implementation, I'm catching and moving to retryBuffer.
        // Should I notify consumers even if persistence failed?
        // Usually, consistency matters. If it's not in the DB, notifying consumers might be too early.
        // However, some consumers might be "ephemeral" (like a real-time feed).
        // The original code was:
        // try { await this.persistence.saveBatch(records); } catch(error) { unshift; throw error; }
        // // Notify batch consumers
        // for (const consumer of this.batchConsumers) { try { await consumer(records); } catch (error) { ... } }
        //
        // This means if persistence fails, consumers are NOT notified. 
        // I will follow this pattern: only notify if saveBatch succeeded (or if no persistence configured).

        if (!this.persistence || records.length > 0) {
          // If we had no persistence, or we had persistence but records were cleared from this.buffer 
          // (meaning it didn't throw before we caught it and moved to retryBuffer)
          
          // Wait, if persistence exists and saveBatch(records) SUCCEEDS, records are NOT in retryBuffer.
          // If it FAILS, they ARE in retryBuffer.
          
          // Check if 'records' were successfully persisted (not in retryBuffer)
          // Actually, 'records' is a local copy. I should check if they were added to retryBuffer.
          const persistedSuccessfully = !this.retryBuffer.some(r => records.includes(r));
          
          if (persistedSuccessfully) {
             for (const consumer of this.batchConsumers) {
               try {
                 await consumer(records);
               } catch (error) {
                 console.error("[proposal-consumer] batch consumer error during flush:", error);
               }
             }
          }
        }
      }
    } finally {
      this.isFlushing = false;

      // If a concurrent call requested a flush while we were busy, run it now
      if (this.pendingFlush) {
        this.pendingFlush = false;
        await this.flush();
      }
    }
  }

  /**
   * Returns the current buffer size.
   */
  public getBufferSize(): number {
    return this.buffer.length;
  }

  /**
   * Returns whether the consumer is currently running.
   */
  public isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Starts the periodic flush timer using setInterval for reliability.
   * Flush errors are caught and logged without stopping the interval.
   */
  private startFlushTimer(): void {
    this.flushTimer = setInterval(async () => {
      try {
        await this.flush();
      } catch (error) {
        console.error("[proposal-consumer] flush timer error:", error);
      }
    }, this.flushIntervalMs);
  }

  /**
   * Stops the periodic flush timer.
   */
  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }
}

/**
 * Factory function to create a configured consumer instance.
 */
export function createProposalConsumer(options?: {
  batchSize?: number;
  flushIntervalMs?: number;
}): ProposalActivityConsumer {
  return new ProposalActivityConsumer(options);
}
