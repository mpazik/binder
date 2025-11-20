import { type Logger } from "./log.ts";
import * as ui from "./ui.ts";
import { createInMemoryFileSystem } from "./lib/filesystem.mock.ts";
import { getTestDatabaseCli } from "./db/db.mock.ts";
import { setupKnowledgeGraph } from "./lib/orchestrator.ts";
import type { AppConfig } from "./config.ts";
import type {
  RuntimeContextInit,
  RuntimeContextWithDb,
  RuntimeContext,
} from "./bootstrap.ts";

export const mockConfig: AppConfig = {
  author: "test-user",
  paths: {
    root: "/test",
    binder: "/test/.binder",
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
    return {
      ...context,
      db,
      kg: setupKnowledgeGraph({ ...context, db }),
    };
  };
