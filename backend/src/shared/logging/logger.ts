/**
 * Structured logger utility for backend.
 * In production (NODE_ENV=production): emits JSON lines only.
 * In development (default): emits human-readable lines only.
 *
 * Automatically includes requestId from AsyncLocalStorage when available.
 */

import { requestIdStorage } from "../http/requestId.js";

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

    const requestId = requestIdStorage.getStore();
    const enriched = requestId ? { requestId, ...meta } : meta;

    if (isProduction) {
      consoleFn(
        JSON.stringify({ level, prefix, ts: timestamp(), msg, ...enriched }),
      );
    } else {
      consoleFn(
        `[${level.toUpperCase()}] [${prefix}] ${timestamp()} ${msg}${formatMeta(enriched)}`,
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
