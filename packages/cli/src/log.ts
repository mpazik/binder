import {
  isErr,
  isErrorObject,
  ok,
  type ResultAsync,
  wrapError,
} from "@binder/utils";
import type { FileSystem } from "./lib/filesystem.ts";

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const levelPriority: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export type Logger = {
  logPath: string;
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

const formatErrorObject = (error: unknown): string => {
  if (isErrorObject(error)) {
    const baseMsg = error.message || error.key;
    const dataStr = error.data ? ` ${JSON.stringify(error.data)}` : "";
    return baseMsg + dataStr;
  }
  if (error instanceof Error) {
    return formatError(error);
  }
  return String(error);
};

export const createLogger = async (
  fs: FileSystem,
  options: {
    binderDir: string;
    level?: LogLevel;
    printLogs?: boolean;
    logFile?: string;
  },
): ResultAsync<Logger> => {
  const dir = `${options.binderDir}/logs`;
  const logFilePath = `${dir}/${options.logFile ?? "cli.log"}`;
  const dirResult = await fs.mkdir(dir, { recursive: true });
  if (isErr(dirResult))
    return wrapError(dirResult, "Failed to create logs directory", {
      path: dir,
    });

  await rotateLogFile(logFilePath);

  const logfile = Bun.file(logFilePath);
  const writer = logfile.writer();

  const writeLog = (message: string) => {
    writer.write(message);
    writer.flush();
    if (options.printLogs) {
      process.stderr.write(message);
    }
  };

  const level = options.level ?? "info";
  let last = Date.now();

  const shouldLog = (input: LogLevel): boolean => {
    return levelPriority[input] >= levelPriority[level];
  };

  const build = (
    level: LogLevel,
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
          return pfx + formatErrorObject(value);
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
        level.toUpperCase().padEnd(5),
        next.toISOString().split(".")[0],
        "+" + diff + "ms",
        prefix,
        message,
      ]
        .filter(Boolean)
        .join(" ") + "\n"
    );
  };

  const info = (message?: any, extra?: Record<string, any>) => {
    if (shouldLog("info")) {
      writeLog(build("info", message, extra));
    }
  };

  return ok({
    logPath: logFilePath,
    debug(message?: any, extra?: Record<string, any>) {
      if (shouldLog("debug")) {
        writeLog(build("debug", message, extra));
      }
    },
    info,
    error(message?: any, extra?: Record<string, any>) {
      if (shouldLog("error")) {
        writeLog(build("error", message, extra));
      }
    },
    warn(message?: any, extra?: Record<string, any>) {
      if (shouldLog("warn")) {
        writeLog(build("warn", message, extra));
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
  });
};
