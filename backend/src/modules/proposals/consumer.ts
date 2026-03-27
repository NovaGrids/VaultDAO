/**
 * Proposal Event Consumer
 *
 * Consumes normalized events and transforms them into proposal activity records.
 * This is the main entry point for the proposal indexing service.
 */

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
  private buffer: ProposalActivityRecord[] = [];
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private consumers: ProposalEventConsumer[] = [];
  private batchConsumers: ProposalBatchConsumer[] = [];
  private persistence: ProposalActivityPersistence | null = null;
  private isRunning: boolean = false;

  constructor(options?: { batchSize?: number; flushIntervalMs?: number }) {
    this.batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE;
    this.flushIntervalMs =
      options?.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  }

  /**
   * Starts the consumer's periodic flush timer.
   */
  public start(): void {
    if (this.isRunning) {
      console.debug("[proposal-consumer] already running");
      return;
    }

    this.isRunning = true;
    this.startFlushTimer();
    console.debug("[proposal-consumer] started");
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
    await this.flush();
    console.debug("[proposal-consumer] stopped");
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
   */
  public async flush(): Promise<void> {
    if (this.buffer.length === 0) {
      return;
    }

    const records = [...this.buffer];
    this.buffer = [];

    console.debug("[proposal-consumer] flushing", records.length, "records");

    // Save to persistence if configured
    if (this.persistence) {
      try {
        await this.persistence.saveBatch(records);
        console.debug(
          "[proposal-consumer] persisted",
          records.length,
          "records",
        );
      } catch (error) {
        console.error("[proposal-consumer] persistence error:", error);
        // Re-add records to buffer on persistence failure
        this.buffer.unshift(...records);
        throw error;
      }
    }

    // Notify batch consumers
    for (const consumer of this.batchConsumers) {
      try {
        await consumer(records);
      } catch (error) {
        console.error(
          "[proposal-consumer] batch consumer error during flush:",
          error,
        );
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
