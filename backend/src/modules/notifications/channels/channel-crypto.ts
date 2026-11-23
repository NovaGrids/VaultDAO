import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

/**
 * Envelope-encrypted secret stored at rest (KMS / sealed-secret style).
 * Each secret is encrypted with a fresh 256-bit DEK (AES-256-GCM), and the
 * DEK itself is wrapped by the KMS key identified by `keyId`.
 */
export interface SealedSecretEnvelope {
  version: 1;
  algorithm: "aes-256-gcm";
  keyId: string;
  /** Base64-encoded wrapped DEK (iv || authTag || ciphertext) */
  encryptedDek: string;
  /** Base64-encoded 12-byte GCM nonce for the payload */
  iv: string;
  /** Base64-encoded 16-byte GCM authentication tag for the payload */
  authTag: string;
  /** Base64-encoded ciphertext of the serialized secret payload */
  ciphertext: string;
}

/**
 * Pluggable KMS key-wrapping interface (compatible with AWS KMS, GCP KMS,
 * HashiCorp Vault Transit, or the built-in local KEK provider).
 */
export interface KmsKeyProvider {
  activeKeyId(): string;
  wrapDataKey(plaintextDek: Buffer, keyId: string): Promise<string>;
  unwrapDataKey(encryptedDek: string, keyId: string): Promise<Buffer>;
}

function normalizeKeyMaterial(raw: string | Buffer): Buffer {
  if (Buffer.isBuffer(raw)) {
    if (raw.length === 32) return Buffer.from(raw);
    return createHash("sha256").update(raw).digest();
  }
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  const b64 = Buffer.from(trimmed, "base64");
  if (b64.length === 32 && b64.toString("base64") === trimmed) {
    return b64;
  }
  return createHash("sha256").update(trimmed, "utf8").digest();
}

/**
 * Local AES-256-GCM KMS provider supporting multiple versioned KEKs for
 * zero-downtime key rotation.
 */
export class LocalKmsKeyProvider implements KmsKeyProvider {
  private readonly keys: Map<string, Buffer>;
  private readonly currentKeyId: string;

  constructor(keys: Record<string, string | Buffer>, activeKeyId?: string) {
    const entries = Object.entries(keys);
    if (entries.length === 0) {
      throw new Error("LocalKmsKeyProvider requires at least one key");
    }
    this.keys = new Map();
    for (const [id, material] of entries) {
      this.keys.set(id, normalizeKeyMaterial(material));
    }
    this.currentKeyId = activeKeyId ?? entries[0][0];
    if (!this.keys.has(this.currentKeyId)) {
      throw new Error(`Active KMS keyId "${this.currentKeyId}" not found`);
    }
  }

  static fromEnv(
    env: NodeJS.ProcessEnv = process.env
  ): LocalKmsKeyProvider {
    if (env.NOTIFICATION_KMS_KEYS) {
      const parsed = JSON.parse(env.NOTIFICATION_KMS_KEYS) as Record<
        string,
        string
      >;
      return new LocalKmsKeyProvider(
        parsed,
        env.NOTIFICATION_KMS_ACTIVE_KEY_ID
      );
    }
    const master = env.NOTIFICATION_KMS_MASTER_KEY;
    if (master && master.trim().length > 0) {
      const keyId = env.NOTIFICATION_KMS_ACTIVE_KEY_ID ?? "kms-v1";
      return new LocalKmsKeyProvider({ [keyId]: master }, keyId);
    }
    // Ephemeral dev/test fallback key (never persisted)
    return new LocalKmsKeyProvider({ "ephemeral-dev-v1": randomBytes(32) }, "ephemeral-dev-v1");
  }

  activeKeyId(): string {
    return this.currentKeyId;
  }

  async wrapDataKey(plaintextDek: Buffer, keyId: string): Promise<string> {
    const kek = this.keys.get(keyId);
    if (!kek) {
      throw new Error(`Unknown KMS keyId: ${keyId}`);
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", kek, iv);
    const encrypted = Buffer.concat([cipher.update(plaintextDek), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString("base64");
  }

  async unwrapDataKey(encryptedDek: string, keyId: string): Promise<Buffer> {
    const kek = this.keys.get(keyId);
    if (!kek) {
      throw new Error(`Unknown KMS keyId: ${keyId}`);
    }
    const raw = Buffer.from(encryptedDek, "base64");
    if (raw.length < 29) {
      throw new Error("Malformed wrapped DEK");
    }
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ciphertext = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", kek, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
}

/**
 * Seal a JSON-serializable secret object into an envelope-encrypted structure.
 */
export async function sealSecret<T>(
  secret: T,
  kms: KmsKeyProvider
): Promise<SealedSecretEnvelope> {
  const keyId = kms.activeKeyId();
  const dek = randomBytes(32);
  try {
    const encryptedDek = await kms.wrapDataKey(dek, keyId);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", dek, iv);
    const plaintext = Buffer.from(JSON.stringify(secret), "utf8");
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      version: 1,
      algorithm: "aes-256-gcm",
      keyId,
      encryptedDek,
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
  } finally {
    dek.fill(0);
  }
}

/**
 * Unseal a previously encrypted secret envelope.
 */
export async function unsealSecret<T>(
  envelope: SealedSecretEnvelope,
  kms: KmsKeyProvider
): Promise<T> {
  if (envelope.version !== 1 || envelope.algorithm !== "aes-256-gcm") {
    throw new Error(`Unsupported sealed secret envelope version=${envelope.version}`);
  }
  const dek = await kms.unwrapDataKey(envelope.encryptedDek, envelope.keyId);
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      dek,
      Buffer.from(envelope.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString("utf8")) as T;
  } finally {
    dek.fill(0);
  }
}

// ---------------------------------------------------------------------------
// Secret-safe structured logger (guarantees tokens/passwords are never logged)
// ---------------------------------------------------------------------------

export type SafeLogLevel = "debug" | "info" | "warn" | "error";

export interface SafeLogEntry {
  level: SafeLogLevel;
  message: string;
  context?: Record<string, unknown>;
}

export interface NotificationLogger {
  log(entry: SafeLogEntry): void;
}

const SECRET_REGEXES: RegExp[] = [
  // Telegram bot tokens: bot123456:ABC-DEF... or raw 123456:ABC...
  /\bbot\d{6,12}:[A-Za-z0-9_-]{20,}/gi,
  /\b\d{6,12}:[A-Za-z0-9_-]{25,}/g,
  // Discord webhook URLs with token
  /https?:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9._-]+/gi,
  // SMTP / URL embedded credentials (e.g. smtps://user:pass@host)
  /\b[a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:[^@\s/]+@/gi,
  // Bearer / API key headers or query params
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(?:api[_-]?key|token|secret|password|passwd|auth)\s*[:=]\s*["']?[^\s"',;}{]+["']?/gi,
  // Common provider prefixes (SendGrid SG., Postmark, etc.)
  /\bSG\.[A-Za-z0-9._-]{16,}/g,
];

const SENSITIVE_FIELD_NAMES = new Set([
  "secret",
  "secrets",
  "token",
  "bottoken",
  "webhookurl",
  "apikey",
  "password",
  "passwd",
  "smtpurl",
  "authorization",
  "encrypteddek",
  "ciphertext",
  "sealedconfig",
]);

/**
 * Redact known secret patterns and explicit secret strings from arbitrary text.
 */
export function redactSecrets(
  input: string,
  extraSecrets: readonly string[] = []
): string {
  let out = input;
  for (const literal of extraSecrets) {
    if (literal && literal.length >= 4) {
      out = out.split(literal).join("[REDACTED_SECRET]");
    }
  }
  for (const re of SECRET_REGEXES) {
    out = out.replace(re, "[REDACTED_SECRET]");
  }
  return out;
}

function sanitizeContextValue(
  value: unknown,
  extraSecrets: readonly string[]
): unknown {
  if (typeof value === "string") {
    return redactSecrets(value, extraSecrets);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeContextValue(item, extraSecrets));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_FIELD_NAMES.has(k.toLowerCase())) {
        out[k] = "[REDACTED_SECRET]";
      } else {
        out[k] = sanitizeContextValue(v, extraSecrets);
      }
    }
    return out;
  }
  return value;
}

/**
 * Wraps any logger sink (including test hooks) so secrets can never leak into
 * log messages or structured context fields.
 */
export class SafeNotificationLogger {
  constructor(private readonly sink: NotificationLogger) {}

  emit(
    level: SafeLogLevel,
    message: string,
    context?: Record<string, unknown>,
    extraSecrets: readonly string[] = []
  ): void {
    this.sink.log({
      level,
      message: redactSecrets(message, extraSecrets),
      context: context
        ? (sanitizeContextValue(context, extraSecrets) as Record<string, unknown>)
        : undefined,
    });
  }

  info(
    message: string,
    context?: Record<string, unknown>,
    extraSecrets?: readonly string[]
  ): void {
    this.emit("info", message, context, extraSecrets);
  }

  warn(
    message: string,
    context?: Record<string, unknown>,
    extraSecrets?: readonly string[]
  ): void {
    this.emit("warn", message, context, extraSecrets);
  }

  error(
    message: string,
    context?: Record<string, unknown>,
    extraSecrets?: readonly string[]
  ): void {
    this.emit("error", message, context, extraSecrets);
  }
}

export const defaultConsoleLogger: NotificationLogger = {
  log(entry) {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      component: "notification-channels",
      ...entry,
    });
    if (entry.level === "error") {
      console.error(line);
    } else if (entry.level === "warn") {
      console.warn(line);
    } else {
      console.log(line);
    }
  },
};
