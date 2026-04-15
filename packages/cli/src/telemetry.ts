import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ErrorObject } from "@binder/utils";
import { isErr, normalizeError, tryCatch } from "@binder/utils";
import {
  type GlobalConfig,
  getGlobalStatePath,
  saveGlobalConfig,
} from "./config.ts";
import {
  BINDER_TELEMETRY_HOST,
  BINDER_TELEMETRY_KEY,
  isDevMode,
} from "./environment.ts";

const USAGE_FILE = "usage.jsonl";
const FLUSH_MARKER_FILE = "telemetry-flush.marker";
const FLUSH_INTERVAL_MS = 4 * 60 * 60 * 1000;

const isDebug = process.env.BINDER_TELEMETRY_DEBUG === "1";

/** Which process interface is generating telemetry events. */
export type TelemetryInterface = "cli" | "lsp" | "mcp";

/** Runtime telemetry configuration resolved from global config and environment. */
export type TelemetryState = {
  enabled: boolean;
  isInternal: boolean;
  reason:
    | "enabled"
    | "disabled-do-not-track"
    | "disabled-by-env"
    | "disabled-in-ci"
    | "disabled-in-test"
    | "disabled-by-config"
    | "disabled-missing-key";
  key?: string;
  host: string;
};

type ExceptionEntry = {
  type: string;
  value: string;
  mechanism: { handled: boolean; synthetic: false };
};

export type TelemetryEvent = { event: string } & Record<string, unknown>;

/** Determine whether telemetry is enabled based on global config and environment variables. */
export const resolveTelemetryState = (
  globalConfig: GlobalConfig,
): TelemetryState => {
  const isInternal = process.env.BINDER_INTERNAL === "1";

  const disabled = (reason: TelemetryState["reason"]): TelemetryState => ({
    enabled: false,
    isInternal,
    reason,
    key: BINDER_TELEMETRY_KEY,
    host: BINDER_TELEMETRY_HOST,
  });

  if (process.env.DO_NOT_TRACK === "1")
    return disabled("disabled-do-not-track");
  if (process.env.BINDER_TELEMETRY_DISABLED === "1")
    return disabled("disabled-by-env");
  if (process.env.CI === "true") return disabled("disabled-in-ci");
  if (process.env.NODE_ENV === "test") return disabled("disabled-in-test");
  if (globalConfig.telemetry === false) return disabled("disabled-by-config");

  if (!BINDER_TELEMETRY_KEY) {
    return {
      enabled: false,
      isInternal,
      reason: "disabled-missing-key",
      host: BINDER_TELEMETRY_HOST,
    };
  }

  return {
    enabled: true,
    isInternal,
    reason: "enabled",
    key: BINDER_TELEMETRY_KEY,
    host: BINDER_TELEMETRY_HOST,
  };
};

const TELEMETRY_NOTICE =
  "Anonymous telemetry is enabled. Set DO_NOT_TRACK=1 to opt out.";

const hasTelemetryPreference = (config: GlobalConfig): boolean =>
  config.telemetry !== undefined && config.telemetry !== null;

const shouldPersistDefault = (options?: { silent?: boolean }): boolean => {
  if (options?.silent) return false;
  if (process.env.CI === "true") return false;
  if (process.env.NODE_ENV === "test") return false;
  return true;
};

type InitTelemetryOptions = {
  silent?: boolean;
  interface?: TelemetryInterface;
  log?: { error: (msg: string, data?: Record<string, unknown>) => void };
  showNotice?: (msg: string) => void;
};

/**
 * Resolve telemetry state from global config and environment.
 * On first run (no preference set), persists `telemetry: true` and shows a notice.
 * Installs process-level error handlers for unhandled exceptions.
 */
export const initializeTelemetry = async (
  globalConfig: GlobalConfig,
  options?: InitTelemetryOptions,
): Promise<{ telemetry: TelemetryState; globalConfig: GlobalConfig }> => {
  let config = globalConfig;

  if (!hasTelemetryPreference(config) && shouldPersistDefault(options)) {
    const updated = { ...config, telemetry: true };
    const saveResult = await saveGlobalConfig(updated);
    if (!isErr(saveResult)) {
      config = updated;
      if (!options?.silent) {
        (options?.showNotice ?? defaultNotice)(TELEMETRY_NOTICE);
      }
    }
  }

  const telemetry = resolveTelemetryState(config);
  const ifc = options?.interface ?? "cli";

  installProcessErrorHandlers(telemetry, ifc, options?.log);

  return { telemetry, globalConfig: config };
};

let processErrorHandlersInstalled = false;

const installProcessErrorHandlers = (
  telemetry: TelemetryState,
  ifc: TelemetryInterface,
  log?: { error: (msg: string, data?: Record<string, unknown>) => void },
): void => {
  if (processErrorHandlersInstalled) return;
  processErrorHandlersInstalled = true;

  process.on("uncaughtException", (exception) => {
    const error = normalizeError(exception);
    log?.error("Uncaught exception", { error });
    trackException(telemetry, {
      error,
      handled: false,
      interface: ifc,
    });
  });

  process.on("unhandledRejection", (reason) => {
    const error = normalizeError(reason);
    log?.error("Unhandled rejection", { error });
    trackException(telemetry, {
      error,
      handled: false,
      interface: ifc,
    });
  });
};

const defaultNotice = (msg: string): void => {
  process.stderr.write(`${msg}\n`);
};

const normalizeToken = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return undefined;
};

const commandSubcommands: Record<string, Set<string>> = {
  docs: new Set(["render", "sync", "lint"]),
  dev: new Set(["backup", "reset"]),
  transaction: new Set([
    "import",
    "export",
    "read",
    "rollback",
    "squash",
    "verify",
    "repair",
    "log",
  ]),
};

/**
 * Extract a telemetry-safe command name from raw argv tokens.
 * Recognises known subcommands (e.g. `docs sync`) and redacts positional arguments.
 */
export const resolveCommandName = (argv: unknown[] | undefined): string => {
  const rootToken = normalizeToken(argv?.[0]);
  if (!rootToken) return "unknown";

  const root = rootToken === "tx" ? "transaction" : rootToken;
  const sub = normalizeToken(argv?.[1]);
  const knownSubcommands = commandSubcommands[root];

  if (knownSubcommands && sub && knownSubcommands.has(sub)) {
    return `${root} ${sub}`;
  }

  return root;
};

const getUsagePath = (): string => join(getGlobalStatePath(), USAGE_FILE);

const appendUsageLine = (event: TelemetryEvent): void => {
  const statePath = getGlobalStatePath();
  mkdirSync(statePath, { recursive: true });

  const line = JSON.stringify({ timestamp: Date.now(), ...event });
  appendFileSync(getUsagePath(), `${line}\n`, "utf-8");
};

/**
 * Track a telemetry event. Appends to local JSONL file and triggers
 * background flush if 24h have elapsed. In debug mode, prints to stderr.
 */
export const track = (
  telemetry: TelemetryState,
  event: TelemetryEvent,
): void => {
  if (!telemetry.enabled) return;

  if (isDebug) {
    process.stderr.write(`[telemetry] ${JSON.stringify(event, null, 2)}\n`);
  }

  const appendResult = tryCatch(() => appendUsageLine(event));
  if (isErr(appendResult)) return;

  triggerFlush(telemetry);
};

/** Convert an ErrorObject cause chain into a PostHog-compatible exception list. */
export const mapExceptionList = (
  error: ErrorObject,
  handled: boolean,
): ExceptionEntry[] => {
  const exceptions: ExceptionEntry[] = [];
  let current: ErrorObject | undefined = error;

  while (current) {
    exceptions.push({
      type: current.key,
      value: current.key,
      mechanism: { handled, synthetic: false },
    });
    current = current.cause;
  }

  return exceptions;
};

/** Track an exception as a `$exception` telemetry event with structured cause chain. */
export const trackException = (
  telemetry: TelemetryState,
  options: {
    error: ErrorObject | Error | unknown;
    handled: boolean;
    interface: TelemetryInterface;
    command?: string;
    action?: string;
  },
): void => {
  const error = normalizeError(options.error);

  track(telemetry, {
    event: "$exception",
    $exception_list: mapExceptionList(error, options.handled),
    $exception_level: "error",
    interface: options.interface,
    ...(options.command ? { command: options.command } : {}),
    ...(options.action ? { action: options.action } : {}),
  });
};

/** One-way hash of a workspace root path, used as a non-identifying project identifier. */
export const hashProjectPath = (workspaceRoot: string): string =>
  createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 16);

const getFlushMarkerPath = (): string =>
  join(getGlobalStatePath(), FLUSH_MARKER_FILE);

const getFlushScriptPath = (): string => {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return isDevMode()
    ? join(currentDir, "telemetry-flush.ts")
    : join(currentDir, "telemetry-flush.js");
};

const isFlushDue = (): boolean => {
  const statResult = tryCatch(() => statSync(getFlushMarkerPath()));
  if (isErr(statResult)) return true;

  return Date.now() - statResult.data.mtimeMs >= FLUSH_INTERVAL_MS;
};

const markFlushAttempt = (): void => {
  const statePath = getGlobalStatePath();
  mkdirSync(statePath, { recursive: true });
  writeFileSync(getFlushMarkerPath(), String(Date.now()), "utf-8");
};

const buildFlushEnv = (
  telemetry: TelemetryState,
  projectRoot?: string,
): Record<string, string | undefined> => ({
  ...process.env,
  BINDER_TELEMETRY_KEY: telemetry.key,
  BINDER_TELEMETRY_HOST: telemetry.host,
  ...(telemetry.isInternal ? { BINDER_INTERNAL: "1" } : {}),
  ...(projectRoot
    ? { BINDER_TELEMETRY_PROJECT_HASH: hashProjectPath(projectRoot) }
    : {}),
});

const triggerFlush = (
  telemetry: TelemetryState,
  options?: { force?: boolean; projectRoot?: string },
): void => {
  if (!telemetry.enabled || !telemetry.key) return;
  if (!options?.force && !isFlushDue()) return;

  const markResult = tryCatch(() => markFlushAttempt());
  if (isErr(markResult)) return;

  const env = buildFlushEnv(telemetry, options?.projectRoot);
  const script = getFlushScriptPath();

  if (isDebug) {
    process.stderr.write(`[telemetry] flushing via ${script}\n`);
    const syncResult = tryCatch(() =>
      spawnSync(process.execPath, [script], {
        env,
        stdio: "inherit",
      }),
    );
    if (isErr(syncResult)) return;
  } else {
    const childResult = tryCatch(() =>
      spawn(process.execPath, [script], {
        detached: true,
        stdio: "ignore",
        env,
      }),
    );
    if (isErr(childResult)) return;
    childResult.data.unref();
  }
};

/**
 * Force an immediate flush. Call on shutdown of long-lived processes (LSP, MCP).
 */
export const forceFlush = (
  telemetry: TelemetryState,
  options?: { projectRoot?: string },
): void => {
  triggerFlush(telemetry, { force: true, projectRoot: options?.projectRoot });
};
