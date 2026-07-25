/**
 * HMAC-SHA256 Request Signing Middleware
 *
 * ## Purpose
 * Provides body integrity verification on top of the existing API key
 * authentication layer. A valid API key proves *identity*; this middleware
 * proves *payload integrity* — a MITM that intercepts the request cannot
 * silently modify the body without detection.
 *
 * ## Canonical Signing String
 * Both the client and server MUST compute HMAC-SHA256 over the identical
 * string. The format is:
 *
 *   `${timestamp}.${rawBody}`
 *
 * Where:
 * - `timestamp` — a Unix epoch value **in milliseconds**, expressed as a
 *   decimal integer string (e.g. `"1721900000000"`).
 * - `rawBody`   — the exact UTF-8 request body bytes **as sent over the
 *   wire**, before any JSON parsing. For requests with no body (GET, HEAD,
 *   OPTIONS, etc.) this MUST be the empty string `""`.
 * - The separator is a single ASCII period `.`.
 *
 * Example (Node.js client):
 * ```ts
 * import { createHmac } from "node:crypto";
 * const timestamp = Date.now().toString();
 * const rawBody   = JSON.stringify(payload); // or "" for bodyless requests
 * const message   = `${timestamp}.${rawBody}`;
 * const signature = "sha256=" + createHmac("sha256", sharedSecret)
 *   .update(message, "utf8")
 *   .digest("hex");
 * // Send: X-Timestamp: <timestamp>  X-Signature: <signature>
 * ```
 *
 * ## Header Scheme
 * - `X-Timestamp: <unix-ms>`           — millisecond Unix epoch as a decimal
 *   integer string. This is the same value interpolated into the canonical
 *   string on the server side.
 * - `X-Signature: sha256=<hex-digest>` — HMAC-SHA256 over the canonical
 *   string, hex-encoded, prefixed with `sha256=`.
 *
 * The existing `Authorization: Bearer <api-key>` header is unchanged; this
 * middleware adds a second, orthogonal verification layer.
 *
 * ## Replay Protection
 * Timestamps more than MAX_SKEW_MS (5 minutes) in either direction — past
 * or future — are rejected. This bounds the window for replay attacks even
 * if an attacker captures a valid signed request.
 *
 * ## Timing Safety
 * Signature comparison uses `crypto.timingSafeEqual` to prevent
 * timing-oracle attacks that could leak the expected HMAC value byte-by-byte.
 *
 * ## Env Variable
 * Set `VAULT_HMAC_SECRET` to a long random string (>= 32 chars recommended).
 * This secret is shared between the server and its trusted API clients. It
 * is DISTINCT from `VAULT_API_KEY` — do not reuse the API key here; mixing
 * concerns would weaken both the identity check and the integrity check.
 * When `VAULT_HMAC_SECRET` is not set, the middleware is a no-op (passes
 * through), mirroring the existing API-key passthrough in development.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import { error } from "./response.js";
import { ErrorCode } from "./errorCodes.js";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum allowed clock skew in milliseconds (5 minutes in either direction). */
export const MAX_SKEW_MS = 5 * 60 * 1000;

/** Request header carrying the Unix-ms timestamp. Case-insensitive on read. */
export const TIMESTAMP_HEADER = "x-timestamp";

/** Request header carrying the HMAC-SHA256 signature. Case-insensitive on read. */
export const SIGNATURE_HEADER = "x-signature";

/** Prefix that MUST appear at the start of the X-Signature value. */
const SIGNATURE_PREFIX = "sha256=";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Compute `"sha256=<hmac-hex>"` over `canonicalString` using `secret`. */
export function computeSignature(secret: string, canonicalString: string): string {
  return (
    SIGNATURE_PREFIX +
    createHmac("sha256", secret).update(canonicalString, "utf8").digest("hex")
  );
}

/**
 * Constant-time string equality. Returns `false` rather than throwing when
 * lengths differ — the length difference is already public information once
 * the signature-prefix length is known. What matters is that we never
 * short-circuit on content.
 */
export function safeEqual(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, "utf8");
    const bufB = Buffer.from(b, "utf8");
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

// ── Raw-body capture ──────────────────────────────────────────────────────────

/**
 * Returns an `express.json()` middleware that, as a side-effect, captures the
 * raw request body bytes and attaches them to `req` as
 * `(req as any).rawBody: Buffer` before JSON parsing occurs.
 *
 * This uses Express's built-in `verify` callback — the only supported way to
 * intercept raw bytes without consuming the stream a second time. Both the raw
 * buffer (for HMAC verification) and the parsed body (for route handlers) are
 * available after this middleware runs.
 *
 * **Mount this instead of a bare `express.json()` call** wherever raw-body
 * capture is needed:
 * ```ts
 * // Replace:  v1Router.use(express.json({ limit: "10kb" }))
 * // With:
 * v1Router.use(createJsonWithRawBody({ limit: "10kb" }));
 * ```
 *
 * Sub-routes that override the body-size limit should also use this helper
 * so the rawBody property is consistently populated:
 * ```ts
 * v1Router.use("/webhooks", createJsonWithRawBody({ limit: "32kb" }), ...);
 * ```
 */
export function createJsonWithRawBody(options: Parameters<typeof express.json>[0] = {}) {
  return express.json({
    ...options,
    verify(req: Request, _res: Response, buf: Buffer) {
      (req as any).rawBody = buf;
    },
  });
}

// ── HMAC signing guard ────────────────────────────────────────────────────────

/**
 * Create an Express middleware that verifies HMAC-SHA256 request signing.
 *
 * @param secretOrProvider  The shared HMAC secret, or a zero-argument function
 *   that returns it (for hot-reload / dynamic config). Pass `undefined` or an
 *   empty string to run in passthrough mode (dev / unconfigured env).
 * @param options.maxSkewMs Clock-skew tolerance in ms (default: 300 000 = 5 min).
 *
 * ### Prerequisites
 * `createJsonWithRawBody()` must be mounted on the same router **before** this
 * middleware so that `(req as any).rawBody` is a `Buffer` when this runs.
 *
 * ### Rejection reasons — all produce 401 UNAUTHORIZED
 * | Condition | Message |
 * |-----------|---------|
 * | `X-Signature` header absent | "Missing X-Signature header" |
 * | `X-Timestamp` header absent | "Missing X-Timestamp header" |
 * | Timestamp not a finite integer | "X-Timestamp must be a valid Unix millisecond integer" |
 * | Timestamp > maxSkewMs in the past | "Request timestamp is too old (replay protection)" |
 * | Timestamp > maxSkewMs in the future | "Request timestamp is too far in the future (clock skew)" |
 * | Signature does not match recomputed HMAC | "Invalid request signature" |
 */
export function createHmacSigningMiddleware(
  secretOrProvider: string | undefined | (() => string | undefined),
  options: { maxSkewMs?: number } = {},
) {
  const maxSkewMs = options.maxSkewMs ?? MAX_SKEW_MS;

  return (req: Request, res: Response, next: NextFunction): void => {
    const secret =
      typeof secretOrProvider === "function"
        ? secretOrProvider()
        : secretOrProvider;

    // Passthrough when no secret is configured (mirrors API-key passthrough).
    if (!secret) {
      return next();
    }

    // ── 1. Extract headers ────────────────────────────────────────────────────
    const signatureHeader = req.get(SIGNATURE_HEADER);
    const timestampHeader = req.get(TIMESTAMP_HEADER);

    if (!signatureHeader) {
      error(res, {
        message: "Unauthorized: Missing X-Signature header",
        status: 401,
        code: ErrorCode.UNAUTHORIZED,
      });
      return;
    }

    if (!timestampHeader) {
      error(res, {
        message: "Unauthorized: Missing X-Timestamp header",
        status: 401,
        code: ErrorCode.UNAUTHORIZED,
      });
      return;
    }

    // ── 2. Parse & validate timestamp ─────────────────────────────────────────
    const tsNumber = Number(timestampHeader);

    // Reject NaN, ±Infinity, floats, and empty strings.
    if (!Number.isFinite(tsNumber) || !Number.isInteger(tsNumber)) {
      error(res, {
        message:
          "Unauthorized: X-Timestamp must be a valid Unix millisecond integer",
        status: 401,
        code: ErrorCode.UNAUTHORIZED,
      });
      return;
    }

    const skew = Date.now() - tsNumber;
    if (Math.abs(skew) > maxSkewMs) {
      error(res, {
        message:
          skew > 0
            ? "Unauthorized: Request timestamp is too old (replay protection)"
            : "Unauthorized: Request timestamp is too far in the future (clock skew)",
        status: 401,
        code: ErrorCode.UNAUTHORIZED,
      });
      return;
    }

    // ── 3. Recompute HMAC & compare ───────────────────────────────────────────
    // rawBody is a Buffer attached by createJsonWithRawBody's verify callback.
    // For bodyless requests (GET etc.) rawBody is absent — canonical uses "".
    const rawBodyStr: string =
      (req as any).rawBody instanceof Buffer
        ? ((req as any).rawBody as Buffer).toString("utf8")
        : "";

    const canonical = `${tsNumber}.${rawBodyStr}`;
    const expected = computeSignature(secret, canonical);

    // MUST use constant-time comparison — plain === leaks timing information.
    if (!safeEqual(signatureHeader, expected)) {
      error(res, {
        message: "Unauthorized: Invalid request signature",
        status: 401,
        code: ErrorCode.UNAUTHORIZED,
      });
      return;
    }

    next();
  };
}
