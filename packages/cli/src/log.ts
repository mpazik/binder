import {
  isErr,
  isErrorObject,
  ok,
  type ResultAsync,
  wrapError,
} from "@binder/utils";
import { Document, isMap, isSeq } from "yaml";
import { applyInlineFormatting } from "./document/yaml.ts";
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
  const message = error.message;
  const stack = error.stack ? `\n${error.stack}` : "";
  const result = message + stack;
  return error.cause instanceof Error && depth < 10
    ? result + "\nCaused by: " + formatError(error.cause, depth + 1)
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
): ResultAsync<{
  log: Logger;
  close: () => void;
}> => {
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

  const shouldLog = (input: LogLevel): boolean => {
    return levelPriority[input] >= levelPriority[level];
  };

  const formatTime = (date: Date): string => {
    const iso = date.toISOString();
    return iso.slice(11, 23);
  };

  const formatValue = (value: unknown): string => {
    if (value && typeof value === "object" && "message" in value) {
      return formatErrorObject(value);
    }
    if (typeof value === "object") {
      return JSON.stringify(value);
    }
    return String(value);
  };

  const isPrimitive = (value: unknown): boolean =>
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean";

  const formatYaml = (obj: Record<string, unknown>, indent: string): string => {
    const filtered = Object.fromEntries(
      Object.entries(obj).filter(([_, v]) => v !== undefined && v !== null),
    );
    const doc = new Document(filtered);
    if (isMap(doc.contents)) {
      applyInlineFormatting(doc.contents);
    }
    const yaml = doc.toString({ indent: 2, lineWidth: 0 });
    return yaml
      .trimEnd()
      .split("\n")
      .map((line) => indent + line)
      .join("\n");
  };

  const build = (
    level: LogLevel,
    message: any,
    extra?: Record<string, any>,
  ): string => {
    const time = formatTime(new Date());
    const lvl = level.toUpperCase().padEnd(5);
    const header = `[${time}] ${lvl}: ${message}`;

    if (!extra || Object.keys(extra).length === 0) {
      return header + "\n";
    }

    const entries = Object.entries(extra).filter(
      ([_, v]) => v !== undefined && v !== null,
    );

    const allPrimitive = entries.every(([_, v]) => isPrimitive(v));
    const inline = entries.map(([k, v]) => `${k}=${formatValue(v)}`).join(" ");

    if (allPrimitive && header.length + 1 + inline.length <= 120) {
      return `${header} ${inline}\n`;
    }

    const multiline = formatYaml(extra, "    ");
    return `${header}\n${multiline}\n\n`;
  };

  const info = (message?: any, extra?: Record<string, any>) => {
    if (shouldLog("info")) {
      writeLog(build("info", message, extra));
    }
  };

  const log: Logger = {
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
  };

  return ok({ log, close: () => writer.end() });
};
