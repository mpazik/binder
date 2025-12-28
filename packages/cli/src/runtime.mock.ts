import { type Logger } from "./log.ts";
import * as ui from "./ui.ts";
import { createInMemoryFileSystem } from "./lib/filesystem.mock.ts";
import { getTestDatabaseCli } from "./db/db.mock.ts";
import { setupKnowledgeGraph } from "./lib/orchestrator.ts";
import { BINDER_DIR } from "./config.ts";
import type { AppConfig } from "./config.ts";
import type { RuntimeContextWithDb, RuntimeContext } from "./runtime.ts";
import { createNavigationCache } from "./document/navigation.ts";

export const mockConfig: AppConfig = {
  author: "test-user",
  paths: {
    root: "/test",
    binder: `/test/${BINDER_DIR}`,
    docs: "/test/docs",
  },
};

export const mockUi: typeof ui = {
  ...ui,
  println: () => {},
  print: () => {},
  error: () => {},
  printError: () => {},
  printData: () => {},
  printTransaction: () => {},
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

export const createMockCommandContext = async (): Promise<RuntimeContext> => {
  const fs = createInMemoryFileSystem();
  await fs.mkdir(mockConfig.paths.root);
  await fs.mkdir(mockConfig.paths.binder);
  await fs.mkdir(mockConfig.paths.docs);
  return {
    config: mockConfig,
    log: mockLog,
    ui: mockUi,
    fs,
  };
};

export const createMockRuntimeContextWithDb =
  async (): Promise<RuntimeContextWithDb> => {
    const context = await createMockCommandContext();
    const db = getTestDatabaseCli();
    const kg = setupKnowledgeGraph({ ...context, db }, {});
    const navigationCache = createNavigationCache(kg);
    return {
      ...context,
      db,
      kg,
      nav: navigationCache.load,
    };
  };
