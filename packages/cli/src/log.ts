export const levels = ["DEBUG", "INFO", "WARN", "ERROR"] as const;
export type Level = (typeof levels)[number];

const levelPriority: Record<Level, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

export type Logger = {
  debug(message?: any, extra?: Record<string, any>): void;
  info(message?: any, extra?: Record<string, any>): void;
  error(message?: any, extra?: Record<string, any>): void;
  warn(message?: any, extra?: Record<string, any>): void;
  time(
    message: string,
    extra?: Record<string, any>,
  ): {
    stop(): void;
    [Symbol.dispose](): void;
  };
};

const rotateLogFile = async (logFilePath: string): Promise<void> => {
  const file = Bun.file(logFilePath);
  if (!(await file.exists())) return;

  const stats = await Bun.file(logFilePath)
    .stat()
    .catch(() => null);
  if (!stats) return;

  const maxSize = 10 * 1024 * 1024;
  if (stats.size < maxSize) return;

  const timestamp = new Date().toISOString().split(".")[0].replace(/:/g, "");
  const archivePath = logFilePath.replace(".log", `.${timestamp}.log`);
  await Bun.$`mv ${logFilePath} ${archivePath}`.quiet().catch(() => {});
};

const formatError = (error: Error, depth = 0): string => {
  const result = error.message;
  return error.cause instanceof Error && depth < 10
    ? result + " Caused by: " + formatError(error.cause, depth + 1)
    : result;
};

export const createLogger = async (options: {
  logDir?: string;
  level?: Level;
  printLogs?: boolean;
}): Promise<Logger> => {
  let logFilePath: string | null = null;

  if (options.logDir && !options.printLogs) {
    await Bun.$`mkdir -p ${options.logDir}`.quiet().catch(() => {});

    logFilePath = `${options.logDir}/cli.log`;
    await rotateLogFile(logFilePath);

    const logfile = Bun.file(logFilePath);
    const writer = logfile.writer();

    process.stderr.write = (msg) => {
      writer.write(msg);
      writer.flush();
      return true;
    };
  }

  const currentLevel = options.level ?? "INFO";
  let last = Date.now();

  const shouldLog = (input: Level): boolean => {
    return levelPriority[input] >= levelPriority[currentLevel];
  };

  const build = (
    level: Level,
    message: any,
    extra?: Record<string, any>,
  ): string => {
    const metadata = {
      pid: process.pid,
      ...extra,
    };

    const prefix = Object.entries(metadata)
      .filter(([_, value]) => value !== undefined && value !== null)
      .map(([key, value]) => {
        const pfx = `${key}=`;
        if (value && typeof value === "object" && "message" in value) {
          return pfx + formatError(value as Error);
        }
        if (typeof value === "object") return pfx + JSON.stringify(value);
        return pfx + value;
      })
      .join(" ");

    const next = new Date();
    const diff = next.getTime() - last;
    last = next.getTime();

    return (
      [
        next.toISOString().split(".")[0],
        "+" + diff + "ms",
        `level=${level}`,
        prefix,
        message,
      ]
        .filter(Boolean)
        .join(" ") + "\n"
    );
  };

  const info = (message?: any, extra?: Record<string, any>) => {
    if (shouldLog("INFO")) {
      process.stderr.write("INFO  " + build("INFO", message, extra));
    }
  };

  return {
    debug(message?: any, extra?: Record<string, any>) {
      if (shouldLog("DEBUG")) {
        process.stderr.write("DEBUG " + build("DEBUG", message, extra));
      }
    },
    info,
    error(message?: any, extra?: Record<string, any>) {
      if (shouldLog("ERROR")) {
        process.stderr.write("ERROR " + build("ERROR", message, extra));
      }
    },
    warn(message?: any, extra?: Record<string, any>) {
      if (shouldLog("WARN")) {
        process.stderr.write("WARN  " + build("WARN", message, extra));
      }
    },
    time(message: string, extra?: Record<string, any>) {
      const now = Date.now();
      info(message, { status: "started", ...extra });
      const stop = () => {
        info(message, {
          status: "completed",
          duration: Date.now() - now,
          ...extra,
        });
      };
      return {
        stop,
        [Symbol.dispose]() {
          stop();
        },
      };
    },
  };
};
