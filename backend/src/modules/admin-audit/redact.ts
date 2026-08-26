/**
 * Redaction helper for admin audit log request bodies.
 *
 * Admin endpoints occasionally carry secrets in their payload (rotating an
 * API key, staging a new HMAC secret, etc). The audit trail must record that
 * a call happened without persisting the secret material itself.
 */

const SENSITIVE_KEY_PATTERN =
  /(password|secret|token|api[-_]?key|authorization|private[-_]?key|seed|mnemonic|signature)/i;

const REDACTED = "[REDACTED]";

export function redactBody(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactBody(item, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    result[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? REDACTED
      : redactBody(val, depth + 1);
  }
  return result;
}
