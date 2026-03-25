import crypto from 'node:crypto';

export const REQUEST_ID_HEADER = 'X-Request-ID' as const;

export function generateRequestId(): string {
  return crypto.randomUUID();
}

