import { isObjectEmpty, noop } from "@binder/utils";
import { type Logger } from "./log.ts";
import { createUi, type Ui } from "./cli/ui.ts";
import { createInMemoryFileSystem } from "./lib/filesystem.mock.ts";
import { getTestDatabaseCli } from "./db/db.mock.ts";
import { setupKnowledgeGraph } from "./lib/orchestrator.ts";
import { BINDER_DIR } from "./config.ts";
import type { AppConfig } from "./config.ts";
import type { RuntimeContextWithDb, RuntimeContext } from "./runtime.ts";
import type { TelemetryState } from "./telemetry.ts";
import { createNavigationCache } from "./document/navigation.ts";
import { createViewCache } from "./document/view-entity.ts";

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
    const kg = setupKnowledgeGraph(
      { ...context, db, views: () => viewCache.load() },
      {
        afterCommit: async (transaction) => {
          if (isObjectEmpty(transaction.configs)) return;
          navigationCache.invalidate();
          viewCache.invalidate();
        },
      },
    );
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
