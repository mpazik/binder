import { join, resolve } from "path";
import process from "node:process";
import {
  type Err,
  type ErrorObject,
  err,
  errorChain,
  fail,
  includes,
  isObjectEmpty,
  isErr,
  normalizeError,
  ok,
  type ResultAsync,
  tryCatch,
  wrapError,
} from "@binder/utils";
import type { KnowledgeGraph } from "@binder/db";
import { type DatabaseCli, openCliDb } from "./db";
import {
  type AppConfig,
  DB_FILE,
  findBinderRoot,
  getGlobalStatePath,
  type GlobalConfig,
  loadGlobalConfig,
  loadWorkspaceConfig,
} from "./config.ts";
import { createUi, type Ui } from "./cli/ui.ts";
import { createRealFileSystem, type FileSystem } from "./lib/filesystem.ts";
import { setupCleanupHandlers } from "./lib/lock.ts";
import {
  type OrchestratorCallbacks,
  setupKnowledgeGraph,
} from "./lib/orchestrator.ts";
import { createLogger, type Logger, type LogLevel } from "./log.ts";
import { isDevMode } from "./environment.ts";
import {
  createNavigationCache,
  type NavigationLoader,
} from "./document/navigation.ts";
import { serializeFormats } from "./utils/serialize.ts";
import { createViewCache, type ViewLoader } from "./document/view-entity.ts";
import { migrateLegacyDataLayout } from "./migration.ts";
import {
  initializeTelemetry,
  resolveCommandName,
  track,
  type TelemetryInterface,
  type TelemetryState,
} from "./telemetry.ts";

/** Error keys that represent expected user errors — no telemetry emitted. */
const SILENT_ERROR_KEYS = new Set(["entity-not-found", "workspace-not-found"]);

type RuntimeOptions = {
  logLevel?: LogLevel;
  printLogs?: boolean;
  silent?: boolean;
  telemetryInterface?: TelemetryInterface;
};

export type { TelemetryState };

export type GlobalOptions = RuntimeOptions & {
  cwd?: string;
  quiet?: boolean;
};

export type RuntimeContextInit = RuntimeOptions & {
  globalConfig: GlobalConfig;
  telemetry: TelemetryState;
  log: Logger;
  fs: FileSystem;
  logFile?: string;
};

export type RuntimeContext = {
  config: AppConfig;
  telemetry: TelemetryState;
  log: Logger;
  ui: Ui;
  fs: FileSystem;
};

export type RuntimeContextWithDb = RuntimeContext & {
  db: DatabaseCli;
  kg: KnowledgeGraph;
  nav: NavigationLoader;
  views: ViewLoader;
};

export type RuntimeDbCallbacks = {
  onFilesUpdated?: (paths: string[]) => void;
};

export type CommandHandlerMinimal<TArgs = object> = (
  context: RuntimeContextInit & { args: TArgs & GlobalOptions },
) => ResultAsync<string | void>;

export type CommandHandler<TArgs = object> = (
  context: RuntimeContext & { args: TArgs & GlobalOptions },
) => ResultAsync<string | void>;

export type CommandHandlerWithDb<TArgs = object> = (
  context: RuntimeContextWithDb & { args: TArgs & GlobalOptions },
) => ResultAsync<string | void>;

const defaultUi = createUi();

const fatalError = (
  error: ErrorObject | Err<ErrorObject>,
  log?: Logger,
  silent = false,
): never => {
  const errorObj = normalizeError(error);
  log?.error(`${errorObj.key}: ${errorObj.message}`, errorObj.data);
  if (!silent) {
    defaultUi.printError(errorObj);
    if (log) {
      defaultUi.error(`See log: ${log.logPath}`);
    }
  }
  process.exit(1);
};

export const initializeMinimalRuntime = async (
  options?: RuntimeOptions,
): ResultAsync<{ runtime: RuntimeContextInit; close: () => void }> => {
  const fs = createRealFileSystem();
  const logLevel = options?.logLevel || (isDevMode() ? "debug" : "info");

  const logResult = await createLogger(fs, {
    binderDir: getGlobalStatePath(),
    logFile: "binder.log",
    level: logLevel,
    printLogs: options?.printLogs || false,
  });
  if (isErr(logResult)) return logResult;

  const { log, close: closeLogger } = logResult.data;

  const globalConfigResult = await loadGlobalConfig();
  if (isErr(globalConfigResult))
    return fail("config-error", "Failed to load global config", {
      data: { cause: globalConfigResult.error },
    });

  const { telemetry, globalConfig } = await initializeTelemetry(
    globalConfigResult.data,
    {
      silent: options?.silent,
      interface: options?.telemetryInterface,
      log,
      showNotice: (msg) => defaultUi.info(msg),
    },
  );

  return ok({
    runtime: {
      logLevel,
      printLogs: options?.printLogs || false,
      silent: options?.silent || false,
      globalConfig,
      telemetry,
      log,
      fs,
    },
    close: closeLogger,
  });
};

export const initializeRuntime = async (
  runtime: RuntimeContextInit,
  root: string,
): ResultAsync<{
  runtime: RuntimeContext;
  close: () => void;
}> => {
  const { globalConfig, fs } = runtime;

  const configResult = await loadWorkspaceConfig(root, globalConfig);
  if (isErr(configResult))
    return fail("config-error", "Failed to load workspace config", {
      data: { root, cause: configResult.error },
    });

  const config = configResult.data;
  const logResult = await createLogger(fs, {
    binderDir: config.paths.binder,
    logFile: runtime.logFile ?? "cli.log",
    level: runtime.logLevel ?? config.logLevel,
    printLogs: runtime.printLogs,
  });
  if (isErr(logResult)) return logResult;

  const { log, close } = logResult.data;

  return ok({
    runtime: { config, telemetry: runtime.telemetry, log, ui: createUi(), fs },
    close,
  });
};

export const initializeDbRuntime = async (
  context: RuntimeContext,
  callbacks?: RuntimeDbCallbacks,
): ResultAsync<{
  runtime: RuntimeContextWithDb;
  close: () => void;
}> => {
  const { config, log, fs } = context;

  const migrateResult = await migrateLegacyDataLayout(context);
  if (isErr(migrateResult)) {
    log.error("Failed to migrate workspace data layout", {
      error: migrateResult.error,
    });
    return migrateResult;
  }

  const dbPath = join(config.paths.data, DB_FILE);
  const dbResult = openCliDb({ path: dbPath, migrate: true });
  if (isErr(dbResult)) {
    log.error("Failed to open database", { error: dbResult.error });
    return dbResult;
  }

  const { db, close: closeDb } = dbResult.data;

  const orchestratorCallbacks: OrchestratorCallbacks = {
    afterCommit: async (transaction) => {
      if (isObjectEmpty(transaction.configs)) return;
      navigationCache.invalidate();
      viewCache.invalidate();
    },
    onFilesUpdated: callbacks?.onFilesUpdated,
  };

  const kg = setupKnowledgeGraph(
    { fs, log, config, db, views: () => viewCache.load() },
    orchestratorCallbacks,
  );
  const navigationCache = createNavigationCache(kg);
  const viewCache = createViewCache(kg);

  return ok({
    runtime: {
      ...context,
      kg,
      db,
      nav: navigationCache.load,
      views: viewCache.load,
    },
    close: closeDb,
  });
};

export const initializeFullRuntime = async (
  minimalContext: RuntimeContextInit,
  root: string,
  callbacks?: RuntimeDbCallbacks,
): ResultAsync<{
  runtime: RuntimeContextWithDb;
  close: () => void;
}> => {
  const runtimeResult = await initializeRuntime(minimalContext, root);
  if (isErr(runtimeResult)) return runtimeResult;

  const { runtime: context, close: closeLog } = runtimeResult.data;

  const dbResult = await initializeDbRuntime(context, callbacks);
  if (isErr(dbResult)) return dbResult;

  const { runtime: dbRuntime, close: closeDb } = dbResult.data;

  return ok({
    runtime: dbRuntime,
    close: () => {
      closeDb();
      closeLog();
    },
  });
};

type CommandOptions = {
  logFile?: string;
  silent?: boolean;
  telemetryInterface?: TelemetryInterface;
};

export const bootstrapMinimal = <TArgs extends object = object>(
  handler: CommandHandlerMinimal<TArgs>,
  options?: CommandOptions,
): ((args: TArgs & GlobalOptions) => Promise<void>) => {
  const opts = {
    logFile: "binder.log",
    silent: false,
    ...options,
  };

  return async (args: TArgs & GlobalOptions) => {
    if (args.cwd) {
      process.chdir(resolve(args.cwd));
    }

    const rawArgv = (args as { _?: unknown })._;
    const command = resolveCommandName(
      Array.isArray(rawArgv) ? rawArgv : undefined,
    );
    const startedAt = Date.now();
    const telemetryInterface = opts.telemetryInterface ?? "cli";

    const runtimeResult = await initializeMinimalRuntime({
      logLevel: args.logLevel,
      printLogs: isDevMode() || args.printLogs || false,
      silent: opts.silent,
      telemetryInterface,
    });

    if (isErr(runtimeResult)) {
      return fatalError(
        wrapError(runtimeResult, "Failed to initialize runtime"),
        undefined,
        opts.silent,
      );
    }

    const { runtime: minimalRuntime, close } = runtimeResult.data;

    const result = await tryCatch(() => handler({ ...minimalRuntime, args }));

    if (isErr(result) || isErr(result.data)) {
      const error = normalizeError(
        isErr(result) ? result.error : result.data.error,
      );

      if (!SILENT_ERROR_KEYS.has(error.key)) {
        track(minimalRuntime.telemetry, {
          event: "cli_command",
          command,
          success: false,
          duration_ms: Date.now() - startedAt,
          error_chain: errorChain(error),
        });
      }

      close();
      return fatalError(error, minimalRuntime.log, opts.silent);
    }

    track(minimalRuntime.telemetry, {
      event: "cli_command",
      command,
      success: true,
      duration_ms: Date.now() - startedAt,
    });

    const data = result.data.data;
    if (data && !opts.silent) {
      defaultUi.success(data);
    }
    close();
  };
};

const isQuiet = (args: GlobalOptions & { format?: string }): boolean => {
  if (args.quiet) return true;
  if (!args.format) return false;
  return includes(serializeFormats, args.format);
};

export const runtime = <TArgs extends object = object>(
  handler: CommandHandler<TArgs>,
  options?: CommandOptions,
): ((args: TArgs & GlobalOptions) => Promise<void>) => {
  return bootstrapMinimal<TArgs>(
    async (contextInit) => {
      const { fs } = contextInit;

      const rootResult = await findBinderRoot(fs);
      if (isErr(rootResult))
        return fail("workspace-error", "Failed to find binder root", {
          data: { cause: rootResult.error },
        });

      const root = rootResult.data;
      if (!root)
        return fail(
          "workspace-not-found",
          "Not in a binder workspace. Use 'binder init' to initialize a new workspace.",
        );

      const contextResult = await initializeRuntime(
        { ...contextInit, ...options },
        root,
      );
      if (isErr(contextResult)) return contextResult;

      const { runtime: context, close } = contextResult.data;
      const quiet = isQuiet(contextInit.args);
      const quietContext = { ...context, ui: createUi({ quiet }) };

      const result = await tryCatch(() =>
        handler({
          ...quietContext,
          args: contextInit.args,
        }),
      );

      if (isErr(result) || isErr(result.data)) {
        const error = normalizeError(
          isErr(result) ? result.error : result.data.error,
        );
        close();
        return err(error);
      }

      close();
      return result.data;
    },
    {
      logFile: "cli.log",
      silent: false,
      ...options,
    },
  );
};

export const runtimeWithDb = <TArgs extends object = object>(
  handler: CommandHandlerWithDb<TArgs>,
  options?: CommandOptions,
): ((args: TArgs & GlobalOptions) => Promise<void>) => {
  return runtime<TArgs>(async (context) => {
    const { fs, config, args } = context;
    const { paths } = config;
    const dirResult = await fs.mkdir(paths.binder, { recursive: true });
    if (isErr(dirResult)) return dirResult;

    setupCleanupHandlers(fs, paths.data);

    const dbResult = await initializeDbRuntime(context);
    if (isErr(dbResult)) return dbResult;
    const { runtime: dbRuntime, close } = dbResult.data;

    const result = await handler({ args, ...dbRuntime });
    close();
    return result;
  }, options);
};
