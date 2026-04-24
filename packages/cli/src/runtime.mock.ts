import { isErr, isObjectEmpty, noop } from "@binder/utils";
import { openKnowledgeGraph, type KnowledgeGraph } from "@binder/repo";
import { type Logger } from "./log.ts";
import { createUi, type Ui } from "./cli/ui.ts";
import { createInMemoryFileSystem } from "./lib/filesystem.mock.ts";
import { getTestDatabaseCli } from "./db/db.mock.ts";
import { buildOrchestratorCallbacks } from "./lib/orchestrator.ts";
import { documentProviderSchema } from "./document/document-schema.ts";
import { cliConfigSchema } from "./cli-config-schema.ts";
import { BINDER_DIR, TRANSACTION_LOG_FILE, UNDO_LOG_FILE } from "./config.ts";
import type { AppConfig } from "./config.ts";
import type { RuntimeContextWithDb, RuntimeContext } from "./runtime.ts";
import type { TelemetryState } from "./telemetry.ts";
import { createNavigationCache } from "./document/navigation.ts";
import { createViewCache } from "./document/view-entity.ts";
import { clearLog, logTransaction } from "./lib/journal.ts";

export const mockConfig: AppConfig = {
  author: "test-user",
  paths: {
    root: "/test",
    binder: `/test/${BINDER_DIR}`,
    data: `/test/${BINDER_DIR}/data`,
    backups: `/test/${BINDER_DIR}/data/backups`,
    docs: "/test/docs",
  },
};

export const mockUi: Ui = {
  ...createUi(),
  println: noop,
  print: noop,
  success: noop,
  warning: noop,
  info: noop,
  danger: noop,
  divider: noop,
  heading: noop,
  block: noop,
  keyValue: noop,
  keyValuesInline: noop,
  list: noop,
  confirm: async () => false,
  printRawTransaction: noop,
  printRawTransactions: noop,
  printTransaction: async () => {},
  printTransactions: async () => {},
  error: noop,
  printError: noop,
  printData: noop,
};

export const mockLog: Logger = {
  logPath: ".binder/logs/",
  debug: () => {},
  info: () => {},
  error: () => {},
  warn: () => {},
  time: () => ({
    stop: () => {},
    [Symbol.dispose]: () => {},
  }),
};

export const mockTelemetry: TelemetryState = {
  enabled: false,
  isInternal: false,
  reason: "disabled-missing-key",
  host: "https://us.i.posthog.com",
};

export const createMockCommandContext = async (): Promise<RuntimeContext> => {
  const fs = createInMemoryFileSystem();
  await fs.mkdir(mockConfig.paths.root);
  await fs.mkdir(mockConfig.paths.binder);
  await fs.mkdir(mockConfig.paths.data, { recursive: true });
  await fs.mkdir(mockConfig.paths.backups, { recursive: true });
  await fs.mkdir(mockConfig.paths.docs);
  return {
    config: mockConfig,
    telemetry: mockTelemetry,
    log: mockLog,
    ui: mockUi,
    fs,
  };
};

export const createMockRuntimeContextWithDb =
  async (): Promise<RuntimeContextWithDb> => {
    const context = await createMockCommandContext();
    const db = getTestDatabaseCli();

    // Build callbacks via the same factory used by initializeDbRuntime.
    // kg is captured by reference inside the factory closure.
    const callbackFactory = buildOrchestratorCallbacks(
      { ...context, db, views: () => viewCache.load() },
      {
        afterCommit: async (transaction) => {
          if (isObjectEmpty(transaction.configs)) return;
          navigationCache.invalidate();
          viewCache.invalidate();
        },
      },
    );
    const kg: KnowledgeGraph = openKnowledgeGraph(db, {
      providerSchema: documentProviderSchema,
      configSchema: cliConfigSchema,
      callbacks: callbackFactory(
        // Lazy reference; kg is assigned before the callback runs.
        new Proxy({} as KnowledgeGraph, {
          get: (_target, prop) => (kg as never)[prop as never],
        }),
      ),
    });

    // Wire up journal behavior for tests (mirrors the journal plugin).
    const txPath = `${mockConfig.paths.data}/${TRANSACTION_LOG_FILE}`;
    const undoPath = `${mockConfig.paths.data}/${UNDO_LOG_FILE}`;
    kg.onTransaction(undefined, async (tx) => {
      const logResult = await logTransaction(context.fs, txPath, tx);
      if (isErr(logResult))
        console.error("Journal append failed:", logResult.error);
      const clearResult = await clearLog(context.fs, undoPath);
      if (isErr(clearResult))
        console.error("Undo log clear failed:", clearResult.error);
    });

    const navigationCache = createNavigationCache(kg);
    const viewCache = createViewCache(kg);
    return {
      ...context,
      db,
      kg,
      nav: navigationCache.load,
      views: viewCache.load,
    };
  };
