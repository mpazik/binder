import { join, resolve } from "path";
import process from "node:process";
import {
  createError,
  type Err,
  err,
  type ErrorObject,
  isEmptyObject,
  isErr,
  normalizeError,
  ok,
  type ResultAsync,
  tryCatch,
  wrapError,
} from "@binder/utils";
import { type KnowledgeGraph } from "@binder/db";
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
import { createUi, Style, type Ui } from "./cli/ui.ts";
import { createRealFileSystem, type FileSystem } from "./lib/filesystem.ts";
import { setupCleanupHandlers } from "./lib/lock.ts";
import {
  type OrchestratorCallbacks,
  setupKnowledgeGraph,
} from "./lib/orchestrator.ts";
import { createLogger, type Logger, type LogLevel } from "./log.ts";
import { isDevMode } from "./build-time.ts";
import {
  createNavigationCache,
  type NavigationLoader,
} from "./document/navigation.ts";

type RuntimeOptions = {
  logLevel?: LogLevel;
  printLogs?: boolean;
  silent?: boolean;
};

export type GlobalOptions = RuntimeOptions & {
  cwd?: string;
  quiet?: boolean;
};

export type RuntimeContextInit = RuntimeOptions & {
  globalConfig: GlobalConfig;
  log: Logger;
  fs: FileSystem;
  logFile?: string;
};

export type RuntimeContext = {
  config: AppConfig;
  log: Logger;
  ui: Ui;
  fs: FileSystem;
};

export type RuntimeContextWithDb = RuntimeContext & {
  db: DatabaseCli;
  kg: KnowledgeGraph;
  nav: NavigationLoader;
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

  process.on("uncaughtException", (err) => {
    log.error("Uncaught exception", { error: err });
  });

  process.on("unhandledRejection", (reason) => {
    log.error("Unhandled rejection", {
      error: reason instanceof Error ? reason : String(reason),
    });
  });

  const globalConfigResult = await loadGlobalConfig();
  if (isErr(globalConfigResult)) {
    return err(
      createError("config-error", "Failed to load global config", {
        cause: globalConfigResult.error,
      }),
    );
  }

  return ok({
    runtime: {
      logLevel,
      printLogs: options?.printLogs || false,
      silent: options?.silent || false,
      globalConfig: globalConfigResult.data,
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
  if (isErr(configResult)) {
    return err(
      createError("config-error", "Failed to load workspace config", {
        root,
        cause: configResult.error,
      }),
    );
  }

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
    runtime: { config, log, ui: createUi(), fs },
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
  const dbPath = join(config.paths.binder, DB_FILE);
  const dbResult = openCliDb({ path: dbPath, migrate: true });
  if (isErr(dbResult)) {
    log.error("Failed to open database", { error: dbResult.error });
    return dbResult;
  }

  const { db, close: closeDb } = dbResult.data;

  const orchestratorCallbacks: OrchestratorCallbacks = {
    afterCommit: async (transaction) => {
      if (isEmptyObject(transaction.configurations)) return;
      navigationCache.invalidate();
    },
    onFilesUpdated: callbacks?.onFilesUpdated,
  };

  const kg = setupKnowledgeGraph(
    { fs, log, config, db },
    orchestratorCallbacks,
  );
  const navigationCache = createNavigationCache(kg);

  return ok({
    runtime: { ...context, kg, db, nav: navigationCache.load },
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

  const { runtime, close: closeDb } = dbResult.data;

  return ok({
    runtime,
    close: () => {
      closeDb();
      closeLog();
    },
  });
};

type CommandOptions = {
  logFile?: string;
  silent?: boolean;
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

    const runtimeResult = await initializeMinimalRuntime({
      logLevel: args.logLevel,
      printLogs: isDevMode() || args.printLogs || false,
      silent: opts.silent,
    });

    if (isErr(runtimeResult)) {
      return fatalError(
        wrapError(runtimeResult, "Failed to initialize runtime"),
        undefined,
        opts.silent,
      );
    }

    const { runtime, close } = runtimeResult.data;

    const result = await tryCatch(() =>
      handler({
        ...runtime,
        args,
      }),
    );

    if (isErr(result) || isErr(result.data)) {
      const error = isErr(result) ? result.error : result.data.error!;
      return fatalError(error, runtime.log, opts.silent);
    }

    const data = result.data.data;
    if (data && !opts.silent) {
      defaultUi.println(Style.TEXT_SUCCESS + data + Style.TEXT_NORMAL);
    }
    close();
  };
};

const isQuiet = (args: GlobalOptions & { format?: string }): boolean => {
  if (args.quiet) return true;
  return args.format !== undefined && args.format !== "pretty";
};

export const runtime = <TArgs extends object = object>(
  handler: CommandHandler<TArgs>,
  options?: CommandOptions,
): ((args: TArgs & GlobalOptions) => Promise<void>) => {
  return bootstrapMinimal<TArgs>(
    async (contextInit) => {
      const { fs } = contextInit;

      const rootResult = await findBinderRoot(fs);
      if (isErr(rootResult)) {
        return err(
          createError("workspace-error", "Failed to find binder root", {
            cause: rootResult.error,
          }),
        );
      }

      const root = rootResult.data;
      if (!root) {
        return err(
          createError(
            "workspace-not-found",
            "Not in a binder workspace. Use 'binder init' to initialize a new workspace.",
          ),
        );
      }

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
        const error = isErr(result) ? result.error : result.data.error!;
        return fatalError(error, context.log, options?.silent);
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

    setupCleanupHandlers(fs, paths.binder);

    const dbResult = await initializeDbRuntime(context);
    if (isErr(dbResult)) return dbResult;
    const { runtime, close } = dbResult.data;

    const result = await handler({
      args,
      ...runtime,
    });

    close();

    return result;
  }, options);
};
