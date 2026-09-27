import { createLogger } from "../../shared/logging/logger.js";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

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

/**
 * Returns true when the given IP address is loopback, link-local, or within
 * a private RFC1918 / unique-local range. Used to block SSRF attempts where a
 * webhook target resolves to internal infrastructure.
 */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const parts = address.split(".").map((p) => Number(p));
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    if (normalized === "::1" || normalized === "::") return true;
    if (normalized.startsWith("fe80:")) return true; // link-local
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique-local
    // IPv4-mapped IPv6 (::ffff:a.b.c.d)
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  return true;
}

/**
 * Resolves a webhook host and rejects loopback, link-local, and private
 * address ranges. Call again at delivery time to mitigate DNS rebinding.
 */
export async function assertSafeWebhookHost(hostname: string): Promise<void> {
  const addresses = await lookup(hostname, { all: true });
  if (addresses.length === 0) {
    throw new Error(`Webhook host did not resolve: ${hostname}`);
  }
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new Error(`Webhook host resolves to a blocked address: ${address}`);
    }
  }
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

  /**
   * Delivers a webhook payload with SSRF protection. The target host is
   * re-resolved immediately before the request (mitigating DNS rebinding) and
   * redirects are disabled so a safe host cannot bounce to an internal one.
   */
  public async deliverWebhook(url: string, payload: unknown): Promise<Response> {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      throw new Error(`Webhook URL must use https: ${url}`);
    }
    await assertSafeWebhookHost(parsed.hostname);
    return fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      redirect: "manual",
    });
  }
}

export default DeadLetterService;
