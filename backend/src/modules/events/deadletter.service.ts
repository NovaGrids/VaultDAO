import { createLogger } from "../../shared/logging/logger.js";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const logger = createLogger("deadletter-service");

export interface DeadLetterEntry {
  readonly id: string;
  readonly contractId: string;
  readonly recordId: number;
  readonly retryCount: number;
  readonly addedAt: number;
  processed?: boolean;
}

/**
 * Minimal persistence contract. Any storage adapter (SQL, KV, file) can
 * implement this so dead letters survive process restarts.
 */
export interface DeadLetterStorageAdapter {
  load(): Promise<DeadLetterEntry[]>;
  save(entries: DeadLetterEntry[]): Promise<void>;
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

/**
 * Derives a 32-byte AES key from the configured secret. Falls back to a
 * deterministic development key so local runs work without extra config.
 */
function deriveKey(secret?: string): Buffer {
  const material = secret ?? process.env.WEBHOOK_SECRET_KEY ?? "dev-webhook-secret-key";
  return createHash("sha256").update(material).digest();
}

/**
 * Encrypts a webhook secret for storage at rest using AES-256-GCM.
 * Output format: iv:authTag:ciphertext (all base64).
 */
export function encryptSecret(plaintext: string, secret?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

/**
 * Decrypts a value produced by {@link encryptSecret}. Values that are not in
 * the expected encrypted format are returned unchanged for backward
 * compatibility with previously stored plaintext secrets.
 */
export function decryptSecret(stored: string, secret?: string): string {
  const parts = stored.split(":");
  if (parts.length !== 3) return stored;
  try {
    const [ivB64, tagB64, dataB64] = parts;
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    return stored;
  }
}

export class DeadLetterService {
  private readonly store = new Map<string, DeadLetterEntry>();
  private readonly maxRetries: number;
  private readonly backoffMs: number[];
  private readonly storage?: DeadLetterStorageAdapter;
  private loaded = false;

  constructor(options?: {
    maxRetries?: number;
    backoffMs?: number[];
    storage?: DeadLetterStorageAdapter;
  }) {
    this.maxRetries = options?.maxRetries ?? 5;
    this.backoffMs = options?.backoffMs ?? [1000, 2000, 4000, 8000, 16000];
    this.storage = options?.storage;
  }

  /**
   * Hydrates the in-memory store from the storage adapter. Safe to call
   * multiple times; only the first call performs the load.
   */
  public async load(): Promise<void> {
    if (this.loaded || !this.storage) return;
    const entries = await this.storage.load();
    for (const entry of entries) {
      this.store.set(entry.id, entry);
    }
    this.loaded = true;
    logger.info("dead-letter store hydrated", { count: entries.length });
  }

  private async persist(): Promise<void> {
    if (!this.storage) return;
    await this.storage.save(Array.from(this.store.values()));
  }

  public async add(entry: DeadLetterEntry): Promise<void> {
    this.store.set(entry.id, { ...entry, processed: false });
    await this.persist();
    logger.info("dead-letter added to backend store", { id: entry.id, recordId: entry.recordId });
  }

  public list(): DeadLetterEntry[] {
    return Array.from(this.store.values());
  }

  public get(id: string): DeadLetterEntry | undefined {
    return this.store.get(id);
  }

  public async remove(id: string): Promise<boolean> {
    const deleted = this.store.delete(id);
    if (deleted) await this.persist();
    return deleted;
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
        await this.persist();
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
