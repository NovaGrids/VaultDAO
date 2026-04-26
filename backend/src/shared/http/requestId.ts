import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";

export const requestIdStorage = new AsyncLocalStorage<string>();

export const REQUEST_ID_HEADER = "X-Request-ID" as const;

export function generateRequestId(): string {
  return crypto.randomUUID();
}
