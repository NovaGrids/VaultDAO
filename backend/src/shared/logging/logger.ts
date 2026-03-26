/**
 * Structured logger utility for backend.
 * Outputs human-readable line + JSON for parsing.
 * Levels map to console methods.
 */

interface LogMeta {
  [key: string]: any;
}

interface Logger {
  info(msg: string, meta?: LogMeta): void;
  warn(msg: string, meta?: LogMeta): void;
  error(msg: string, meta?: LogMeta): void;
}

function formatMeta(meta: LogMeta | undefined): string {
  return meta ? ` ${JSON.stringify(meta)}` : '';
}

export function createLogger(prefix: string): Logger {
  const timestamp = () => new Date().toISOString();

  return {
    info: (msg: string, meta) => {
      const line = `[INFO] [${prefix}] ${timestamp()} ${msg}${formatMeta(meta)}`;
      console.log(line);
      console.log(JSON.stringify({ level: 'info', prefix, ts: timestamp(), msg, ...meta }));
    },
    warn: (msg: string, meta) => {
      const line = `[WARN] [${prefix}] ${timestamp()} ${msg}${formatMeta(meta)}`;
      console.warn(line);
      console.log(JSON.stringify({ level: 'warn', prefix, ts: timestamp(), msg, ...meta }));
    },
    error: (msg: string, meta) => {
      const line = `[ERROR] [${prefix}] ${timestamp()} ${msg}${formatMeta(meta)}`;
      console.error(line);
      console.error(JSON.stringify({ level: 'error', prefix, ts: timestamp(), msg, ...meta }));
    },
  };
}

