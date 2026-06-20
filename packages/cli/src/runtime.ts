import { resolve } from "node:path";
import process from "node:process";
import {
  type Err,
  err,
  errorChain,
  type ErrorObject,
  fail,
  includes,
  isErr,
  normalizeError,
  ok,
  type Result,
  type ResultAsync,
  tryCatch,
  wrapError,
} from "@binder/utils";
import type { KnowledgeGraph, ReadonlyKnowledgeGraph } from "@binder/repo";
import {
  open as openRepo,
  openReadonly as openRepoReadonly,
  type ReadonlyRepo,
} from "@binder/repo/local";
import { cliMigrationRunner, cliSchema, type DatabaseCli } from "./db";
import { cliConfigSchema } from "./cli-config-schema.ts";
import {
  type AppConfig,
  BINDER_DIR,
  findBinderRoot,
  getGlobalStatePath,
  type GlobalConfig,
  loadGlobalConfig,
  loadWorkspaceConfig,
} from "./config.ts";
import { createUi, type Ui } from "./cli/ui.ts";
import { createRealFileSystem, type FileSystem } from "./lib/filesystem.ts";
import { createLogger, type Logger, type LogLevel } from "./log.ts";
import { isDevMode } from "./environment.ts";
import {
  createNavigationCache,
  type NavigationLoader,
} from "./document/navigation.ts";
import { serializeFormats } from "./utils/serialize.ts";
import { createViewCache, type ViewLoader } from "./document/view-entity.ts";
import { journalPlugin } from "./plugins/journal/index.ts";
import { undoRepoPlugin } from "./plugins/undo/register.ts";
import { docsPlugin } from "./plugins/docs/index.ts";
import { migrateLegacyDataLayout } from "./migration.ts";
import {
  initializeTelemetry,
  resolveCommandName,
  type TelemetryInterface,
  type TelemetryState,
  track,
} from "./telemetry.ts";

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

export type RuntimeContextReadonly = RuntimeContext & {
  db: DatabaseCli;
  kg: ReadonlyKnowledgeGraph;
};

export type RuntimeDbCallbacks = {
  onFilesUpdated?: (paths: string[]) => void;
};

export type CommandOutcome = {
  output?: string;
  telemetry?: Record<string, unknown>;
};

export type CommandResult = string | void | CommandOutcome;

export type CommandHandlerMinimal<TArgs = object> = (
  context: RuntimeContextInit & { args: TArgs & GlobalOptions },
) => ResultAsync<CommandResult>;

export type CommandHandler<TArgs = object> = (
  context: RuntimeContext & { args: TArgs & GlobalOptions },
) => ResultAsync<CommandResult>;

export type CommandHandlerWithDb<TArgs = object> = (
  context: RuntimeContextWithDb & { args: TArgs & GlobalOptions },
) => ResultAsync<CommandResult>;

export type CommandHandlerReadonly<TArgs = object> = (
  context: RuntimeContextReadonly & { args: TArgs & GlobalOptions },
) => ResultAsync<CommandResult>;

const unpackCommandResult = (
  value: CommandResult,
): { output?: string; telemetry?: Record<string, unknown> } => {
  if (typeof value === "string") return { output: value };
  if (value && typeof value === "object") {
    return { output: value.output, telemetry: value.telemetry };
  }
  return {};
};

/** Collapses a `tryCatch`-wrapped handler result into the inner result. */
const flattenHandlerResult = (
  result: Result<Result<CommandResult>>,
): Result<CommandResult> => (isErr(result) ? result : result.data);

const genericTelemetryFlags = (
  args: Record<string, unknown>,
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  if (typeof args.format === "string") out.format = args.format;
  if (typeof args.namespace === "string") out.namespace = args.namespace;
  return out;
};

const isDryRun = (args: Record<string, unknown>): boolean =>
  args.dryRun === true;

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

  const repoResult = await openRepo(config.paths.root, {
    binderDir: BINDER_DIR,
    config,
    dbSchema: cliSchema,
    migrate: { run: cliMigrationRunner },
    kgConfigSchema: cliConfigSchema,
    plugins: [
      journalPlugin(),
      undoRepoPlugin(),
      // Registered after journal and undo: onCommit/onRollback handlers fire
      // in registration order, so the log is reconciled before docs render.
      docsPlugin({
        // Lazy — db and caches are assigned after openRepo returns; the
        // handler only fires on commit/rollback, well after init.
        context: () => ({
          fs,
          log,
          config,
          db,
          views: () => viewCache.load(),
          invalidateCaches: () => {
            navigationCache.invalidate();
            viewCache.invalidate();
          },
          onFilesUpdated: callbacks?.onFilesUpdated,
        }),
      }),
    ],
    onSubscriberError: (error, context) => {
      log.error("Subscription handler failed", { ...context, error });
    },
  });
  if (isErr(repoResult)) {
    log.error("Failed to open repo", { error: repoResult.error });
    return repoResult;
  }

  const repo = repoResult.data;
  const db: DatabaseCli = repo.db as DatabaseCli;
  const kg: KnowledgeGraph = repo as KnowledgeGraph;

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
    close: () => repo.close(),
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

type ErrorWithLogger = ErrorObject & { logger?: Logger };

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

    const result = flattenHandlerResult(
      await tryCatch(() => handler({ ...minimalRuntime, args })),
    );
    const argsRecord = args as Record<string, unknown>;
    const event = `cli.${command.replace(/ /g, ".")}`;

    if (isErr(result)) {
      const error = normalizeError(result.error) as ErrorWithLogger;

      // skip telemetry on dry run to avoid miscounting
      if (!isDryRun(argsRecord) && !SILENT_ERROR_KEYS.has(error.key)) {
        track(minimalRuntime.telemetry, {
          event,
          success: false,
          duration_ms: Date.now() - startedAt,
          error_chain: errorChain(error),
          ...genericTelemetryFlags(argsRecord),
        });
      }

      close();
      return fatalError(error, error.logger ?? minimalRuntime.log, opts.silent);
    }

    const { output, telemetry: handlerExtras } = unpackCommandResult(
      result.data,
    );

    if (!isDryRun(argsRecord)) {
      track(minimalRuntime.telemetry, {
        event,
        success: true,
        duration_ms: Date.now() - startedAt,
        ...genericTelemetryFlags(argsRecord),
        ...handlerExtras,
      });
    }

    if (output && !opts.silent) {
      defaultUi.success(output);
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
      const rootResult = await findBinderRoot();
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

      const result = flattenHandlerResult(
        await tryCatch(() =>
          handler({
            ...quietContext,
            args: contextInit.args,
          }),
        ),
      );

      if (isErr(result)) {
        const error = normalizeError(result.error) as ErrorWithLogger;
        // We are passing the workspace logger downstream,
        // so the final error message will be logged in the workspace log.
        error.logger = context.log;
        close();
        return err(error);
      }

      close();
      return result;
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

    const dbResult = await initializeDbRuntime(context);
    if (isErr(dbResult)) return dbResult;
    const { runtime: dbRuntime, close } = dbResult.data;

    const result = await handler({ args, ...dbRuntime });
    close();
    return result;
  }, options);
};

export const initializeReadonlyRepoRuntime = async (
  context: RuntimeContext,
): ResultAsync<{
  runtime: RuntimeContextReadonly;
  close: () => void;
}> => {
  const { config, log } = context;

  const repoResult = await openRepoReadonly(config.paths.root, {
    binderDir: BINDER_DIR,
    config,
    dbSchema: cliSchema,
    kgConfigSchema: cliConfigSchema,
  });
  if (isErr(repoResult)) {
    log.error("Failed to open repo read-only", { error: repoResult.error });
    return repoResult;
  }

  const repo = repoResult.data as ReadonlyRepo;
  return ok({
    runtime: {
      ...context,
      db: repo.db as DatabaseCli,
      kg: repo as unknown as ReadonlyKnowledgeGraph,
    },
    close: () => repo.close(),
  });
};

export const runtimeWithReadonlyRepo = <TArgs extends object = object>(
  handler: CommandHandlerReadonly<TArgs>,
  options?: CommandOptions,
): ((args: TArgs & GlobalOptions) => Promise<void>) => {
  return runtime<TArgs>(async (context) => {
    const { args } = context;
    const roResult = await initializeReadonlyRepoRuntime(context);
    if (isErr(roResult)) return roResult;
    const { runtime: roRuntime, close } = roResult.data;
    const result = await handler({ args, ...roRuntime });
    close();
    return result;
  }, options);
};
