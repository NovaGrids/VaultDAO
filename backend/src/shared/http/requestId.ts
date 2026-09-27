import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";

export const requestIdStorage = new AsyncLocalStorage<string>();

export const REQUEST_ID_HEADER = "X-Request-ID" as const;

/**
 * Allowed shape for client-supplied request IDs. Restricting the character
 * set and length prevents log injection (control characters, newlines) and
 * log bloat from arbitrarily long header values.
 */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export function generateRequestId(): string {
  return crypto.randomUUID();
}

export function isValidRequestId(value: unknown): value is string {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value);
}

/**
 * Returns the client-supplied request ID when it matches
 * {@link REQUEST_ID_PATTERN}; otherwise generates a fresh UUID.
 */
export function resolveRequestId(incoming: string | undefined | null): string {
  return isValidRequestId(incoming) ? incoming : generateRequestId();
}
