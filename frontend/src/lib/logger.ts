/**
 * Production-ready logger for VaultDAO frontend.
 * - Logs to console in development
 * - Stripped in production builds (no runtime cost)
 * - Structured logs with metadata support
 * - Levels: debug, info, warn, error
 */

interface LogMeta {
  [key: string]: unknown;
}

class Logger {
  private prefix: string;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  private log(level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR', msg: string, meta?: LogMeta): void {
    if (import.meta.env.DEV) {
      const timestamp = new Date().toISOString();
      const structured = meta ? JSON.stringify(meta) : '';
      const logMsg = `[${this.prefix}] ${timestamp} [${level}] ${msg}${structured ? ` ${structured}` : ''}`;
      // eslint-disable-next-line no-console
      switch (level) {
        case 'DEBUG':
          console.debug(logMsg);
          break;
        case 'INFO':
          console.info(logMsg);
          break;
        case 'WARN':
          console.warn(logMsg);
          break;
        case 'ERROR':
          console.error(logMsg);
          break;
      }
    }
  }

  debug(msg: string, meta?: LogMeta): void {
    this.log('DEBUG', msg, meta);
  }

  info(msg: string, meta?: LogMeta): void {
    this.log('INFO', msg, meta);
  }

  warn(msg: string, meta?: LogMeta): void {
    this.log('WARN', msg, meta);
  }

  error(msg: string, meta?: LogMeta): void {
    this.log('ERROR', msg, meta);
  }
}

// Singleton instance
export const logger = new Logger('VaultDAO');

// Named loggers
export const createLogger = (prefix: string): Logger => new Logger(prefix);

