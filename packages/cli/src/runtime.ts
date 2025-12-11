import { join, resolve } from "path";
import process from "node:process";
import {
  createError,
  type Err,
  err,
  type ErrorObject,
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
import * as ui from "./ui.ts";
import { createRealFileSystem, type FileSystem } from "./lib/filesystem.ts";
import { setupCleanupHandlers } from "./lib/lock.ts";
import { setupKnowledgeGraph } from "./lib/orchestrator.ts";
import { createLogger, type Logger, type LogLevel } from "./log.ts";
import { isDevMode } from "./build-time.ts";

type RuntimeOptions = {
  logLevel?: LogLevel;
  printLogs?: boolean;
  silent?: boolean;
};

export type GlobalOptions = RuntimeOptions & {
  cwd?: string;
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
  ui: typeof ui;
  fs: FileSystem;
};

export type RuntimeContextWithDb = RuntimeContext & {
  db: DatabaseCli;
  kg: KnowledgeGraph;
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

const fatalError = (
  error: ErrorObject | Err<ErrorObject>,
  log?: Logger,
  silent = false,
): never => {
  const errorObj = normalizeError(error);
  log?.error(`${errorObj.key}: ${errorObj.message}`, errorObj.data);
  if (!silent) {
    ui.printError(errorObj);
    if (log) {
      ui.error(`See log: ${log.logPath}`);
    }
  }
  process.exit(1);
};

export const initializeMinimalRuntime = async (
  options?: RuntimeOptions,
): ResultAsync<RuntimeContextInit> => {
  const fs = createRealFileSystem();
  const logLevel = options?.logLevel || (isDevMode() ? "debug" : "info");

  const logResult = await createLogger(fs, {
    binderDir: getGlobalStatePath(),
    logFile: "binder.log",
    level: logLevel,
    printLogs: options?.printLogs || false,
  });
  if (isErr(logResult)) return logResult;

  const log = logResult.data;

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
    logLevel,
    printLogs: options?.printLogs || false,
    silent: options?.silent || false,
    globalConfig: globalConfigResult.data,
    log,
    fs,
  });
};

export const initializeRuntime = async (
  runtime: RuntimeContextInit,
  root: string,
): ResultAsync<RuntimeContext> => {
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

  return ok({
    config,
    log: logResult.data,
    ui,
    fs,
  });
};

export const initializeDbRuntime = async (
  context: RuntimeContext,
): ResultAsync<RuntimeContextWithDb> => {
  const { config, log, fs } = context;
  const dbPath = join(config.paths.binder, DB_FILE);
  const dbResult = openCliDb({ path: dbPath, migrate: true });
  if (isErr(dbResult)) {
    log.error("Failed to open database", { error: dbResult.error });
    return dbResult;
  }

  const db = dbResult.data;
  const kg = setupKnowledgeGraph({ fs, log, config, db });

  return ok({ ...context, kg, db });
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

    const runtime = runtimeResult.data;

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
      ui.println(ui.Style.TEXT_SUCCESS + data + ui.Style.TEXT_NORMAL);
    }
  };
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

      const context = contextResult.data;
      const result = await tryCatch(() =>
        handler({
          ...context,
          args: contextInit.args,
        }),
      );

      if (isErr(result) || isErr(result.data)) {
        const error = isErr(result) ? result.error : result.data.error!;
        // we want to use local logger
        return fatalError(error, context.log, options?.silent);
      }

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

    return handler({
      args,
      ...dbResult.data,
    });
  }, options);
};
