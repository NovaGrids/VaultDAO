import { createLogger } from "../../shared/logging/logger.js";

const logger = createLogger("deadletter-service");

export interface DeadLetterEntry {
  readonly id: string;
  readonly contractId: string;
  readonly recordId: number;
  readonly retryCount: number;
  readonly addedAt: number;
  processed?: boolean;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export class DeadLetterService {
  private readonly store = new Map<string, DeadLetterEntry>();
  private readonly maxRetries: number;
  private readonly backoffMs: number[];

  constructor(options?: { maxRetries?: number; backoffMs?: number[] }) {
    this.maxRetries = options?.maxRetries ?? 5;
    this.backoffMs = options?.backoffMs ?? [1000, 2000, 4000, 8000, 16000];
  }

  public add(entry: DeadLetterEntry): void {
    this.store.set(entry.id, { ...entry, processed: false });
    logger.info("dead-letter added to backend store", { id: entry.id, recordId: entry.recordId });
  }

  public list(): DeadLetterEntry[] {
    return Array.from(this.store.values());
  }

  public get(id: string): DeadLetterEntry | undefined {
    return this.store.get(id);
  }

  public remove(id: string): boolean {
    return this.store.delete(id);
  }

  /**
   * Attempts to process a dead-letter entry by calling the provided handler.
   * The handler should throw on failure. This method implements exponential
   * backoff up to configured retries. On success the entry is removed and
   * true is returned. On exhaustion it remains and false is returned.
   */
  public async processDeadLetter(id: string, handler: () => Promise<void>): Promise<boolean> {
    const entry = this.store.get(id);
    if (!entry) throw new Error(`Dead-letter entry not found: ${id}`);

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        await handler();
        // success
        this.store.delete(id);
        logger.info("dead-letter processed successfully", { id, attempt });
        return true;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.warn("dead-letter processing attempt failed", { id, attempt, error: errMsg });
        if (attempt >= this.maxRetries) break;
        const backoff = this.backoffMs[attempt] ?? this.backoffMs[this.backoffMs.length - 1];
        await sleep(backoff);
      }
    }

    logger.error("dead-letter processing exhausted retries", { id });
    return false;
  }
}

export default DeadLetterService;
