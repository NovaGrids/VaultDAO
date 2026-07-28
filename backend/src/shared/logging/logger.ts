/**
 * Structured logger utility for backend.
 * In production (NODE_ENV=production): emits JSON lines only.
 * In development (default): emits human-readable lines only.
 *
 * Automatically includes requestId (and optionally method/path) from the
 * ambient RequestContext propagated via AsyncLocalStorage.  Falls back to
 * the legacy requestIdStorage when no full context is available, so
 * pre-existing code continues to work during the migration period.
 */

import { requestIdStorage } from "../http/requestId.js";
import { requestContextStorage } from "../http/requestContext.js";

interface LogMeta {
  [key: string]: any;
}

interface Logger {
  debug(msg: string, meta?: LogMeta): void;
  info(msg: string, meta?: LogMeta): void;
  warn(msg: string, meta?: LogMeta): void;
  error(msg: string, meta?: LogMeta): void;
}

function formatMeta(meta: LogMeta | undefined): string {
  return meta ? ` ${JSON.stringify(meta)}` : "";
}

export function createLogger(
  prefix: string,
  nodeEnv: string = process.env.NODE_ENV ?? "development",
): Logger {
  const timestamp = () => new Date().toISOString();
  const isProduction = nodeEnv === "production";

  function emit(
    level: string,
    consoleFn: (...args: any[]) => void,
    msg: string,
    meta?: LogMeta,
  ): void {
    if (level === "debug" && isProduction) return;

    // Prefer the richer RequestContext; fall back to legacy requestIdStorage.
    const ctx = requestContextStorage.getStore();
    const requestId = ctx?.requestId ?? requestIdStorage.getStore();

    const enriched: LogMeta = {};
    if (requestId) enriched["requestId"] = requestId;
    // Include method and path only in structured (production) output to avoid
    // making development logs too noisy; they already appear in the access log.
    if (isProduction && ctx) {
      if (ctx.method) enriched["method"] = ctx.method;
      if (ctx.path) enriched["path"] = ctx.path;
    }

    const merged = { ...enriched, ...meta };
    const hasExtra = Object.keys(merged).length > 0;

    if (isProduction) {
      consoleFn(
        JSON.stringify({
          level,
          prefix,
          ts: timestamp(),
          msg,
          ...(hasExtra ? merged : {}),
        }),
      );
    } else {
      consoleFn(
        `[${level.toUpperCase()}] [${prefix}] ${timestamp()} ${msg}${hasExtra ? formatMeta(merged) : ""}`,
      );
    }
  }

  return {
    debug: (msg, meta) => emit("debug", console.debug, msg, meta),
    info: (msg, meta) => emit("info", console.log, msg, meta),
    warn: (msg, meta) => emit("warn", console.warn, msg, meta),
    error: (msg, meta) => emit("error", console.error, msg, meta),
  };
}
