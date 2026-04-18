enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

class Logger {
  private context: string;
  private static level = process.env.NODE_ENV === 'production'
    ? LogLevel.WARN
    : LogLevel.DEBUG;

  constructor(context: string) {
    this.context = context;
  }

  debug(message: string, ...args: unknown[]): void {
    if (Logger.level <= LogLevel.DEBUG) {
      console.debug(`[${this.context}] ${message}`, ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (Logger.level <= LogLevel.INFO) {
      console.info(`[${this.context}] ${message}`, ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (Logger.level <= LogLevel.WARN) {
      console.warn(`[${this.context}] ${message}`, ...args);
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (Logger.level <= LogLevel.ERROR) {
      console.error(`[${this.context}] ${message}`, ...args);
    }
  }
}

export function createLogger(context: string): Logger {
  return new Logger(context);
}

export type { Logger };
