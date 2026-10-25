/**
 * Bounded in-memory record of webhook delivery attempts.
 *
 * Keeps at most `cap` entries with ring-buffer semantics (the oldest entries
 * are evicted first) so unbounded delivery history cannot grow memory
 * without bound. Used for operator inspection of recent webhook outcomes.
 */

export interface WebhookDeliveryRecord {
  readonly webhookId: string;
  readonly eventType: string;
  readonly status: "success" | "failure";
  readonly durationMs: number;
  readonly timestamp: string;
}

export class WebhookDeliveryMetrics {
  private readonly entries: WebhookDeliveryRecord[] = [];

  constructor(private readonly cap: number = 100) {
    if (!Number.isInteger(cap) || cap <= 0) {
      throw new Error("WebhookDeliveryMetrics cap must be a positive integer.");
    }
  }

  /** Record one delivery attempt, evicting the oldest entries past the cap. */
  public recordDelivery(record: WebhookDeliveryRecord): void {
    this.entries.push(record);
    while (this.entries.length > this.cap) {
      this.entries.shift();
    }
  }

  /** Number of retained entries (never exceeds the cap). */
  public get size(): number {
    return this.entries.length;
  }

  /** The `n` most recent entries, oldest first. */
  public recent(n: number): WebhookDeliveryRecord[] {
    if (n <= 0) return [];
    return this.entries.slice(-n);
  }

  /** Clear all retained entries. */
  public reset(): void {
    this.entries.length = 0;
  }
}
