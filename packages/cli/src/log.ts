export const levels = ["DEBUG", "INFO", "WARN", "ERROR"] as const;
export type Level = (typeof levels)[number];

const levelPriority: Record<Level, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

const level: Level = "INFO";

function shouldLog(input: Level): boolean {
  return levelPriority[input] >= levelPriority[level];
}

export type Logger = {
  debug(message?: any, extra?: Record<string, any>): void;
  info(message?: any, extra?: Record<string, any>): void;
  error(message?: any, extra?: Record<string, any>): void;
  warn(message?: any, extra?: Record<string, any>): void;
  tag(key: string, value: string): Logger;
  clone(): Logger;
  time(
    message: string,
    extra?: Record<string, any>,
  ): {
    stop(): void;
    [Symbol.dispose](): void;
  };
};

const loggers = new Map<string, Logger>();

export const Log = create({ service: "default" });

export interface Options {
  print: boolean;
  dev?: boolean;
  level?: Level;
}

const logpath = "";
export function file() {
  return logpath;
}

function formatError(error: Error, depth = 0): string {
  const result = error.message;
  return error.cause instanceof Error && depth < 10
    ? result + " Caused by: " + formatError(error.cause, depth + 1)
    : result;
}

let last = Date.now();
export function create(tags?: Record<string, any>) {
  tags = tags || {};

  const service = tags["service"];
  if (service && typeof service === "string") {
    const cached = loggers.get(service);
    if (cached) {
      return cached;
    }
  }

  function build(message: any, extra?: Record<string, any>) {
    const prefix = Object.entries({
      ...tags,
      ...extra,
    })
      .filter(([_, value]) => value !== undefined && value !== null)
      .map(([key, value]) => {
        const prefix = `${key}=`;
        if (value instanceof Error) return prefix + formatError(value);
        if (typeof value === "object") return prefix + JSON.stringify(value);
        return prefix + value;
      })
      .join(" ");
    const next = new Date();
    const diff = next.getTime() - last;
    last = next.getTime();
    return (
      [next.toISOString().split(".")[0], "+" + diff + "ms", prefix, message]
        .filter(Boolean)
        .join(" ") + "\n"
    );
  }
  const result: Logger = {
    debug(message?: any, extra?: Record<string, any>) {
      if (shouldLog("DEBUG")) {
        process.stderr.write("DEBUG " + build(message, extra));
      }
    },
    info(message?: any, extra?: Record<string, any>) {
      if (shouldLog("INFO")) {
        process.stderr.write("INFO  " + build(message, extra));
      }
    },
    error(message?: any, extra?: Record<string, any>) {
      if (shouldLog("ERROR")) {
        process.stderr.write("ERROR " + build(message, extra));
      }
    },
    warn(message?: any, extra?: Record<string, any>) {
      if (shouldLog("WARN")) {
        process.stderr.write("WARN  " + build(message, extra));
      }
    },
    tag(key: string, value: string) {
      if (tags) tags[key] = value;
      return result;
    },
    clone() {
      return create({ ...tags });
    },
    time(message: string, extra?: Record<string, any>) {
      const now = Date.now();
      result.info(message, { status: "started", ...extra });
      function stop() {
        result.info(message, {
          status: "completed",
          duration: Date.now() - now,
          ...extra,
        });
      }
      return {
        stop,
        [Symbol.dispose]() {
          stop();
        },
      };
    },
  };

  if (service && typeof service === "string") {
    loggers.set(service, result);
  }

  return result;
}
