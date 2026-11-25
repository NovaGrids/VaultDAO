/**
 * Webhook URL validation (#2215 follow-up).
 *
 * Delivery endpoints must be reachable over TLS from the backend and must
 * not point at the backend itself, loopback, link-local or private ranges —
 * otherwise an attacker who can register a webhook could use the backend as
 * a proxy into internal services (SSRF).
 */

export interface WebhookUrlCheck {
  readonly ok: boolean;
  readonly message?: string;
}

const BLOCKED_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^\[?::1\]?$/,
  /\.internal$/i,
];

export function validateWebhookUrl(rawUrl: string): WebhookUrlCheck {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, message: "url must be a valid absolute URL" };
  }

  if (parsed.protocol !== "https:") {
    return { ok: false, message: "url must use https" };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAME_PATTERNS.some((pattern) => pattern.test(hostname))) {
    return {
      ok: false,
      message: "url must not point at loopback, link-local, private or internal addresses",
    };
  }

  // No userinfo: credentials in the URL would leak into logs.
  if (parsed.username || parsed.password) {
    return { ok: false, message: "url must not embed credentials" };
  }

  return { ok: true };
}
