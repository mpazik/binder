import { openKnowledgeGraph } from "@binder/db";
import { getTestDatabase } from "@binder/db/mocks";
import type {
  Config,
  CommandContext,
  CommandContextWithDb,
} from "./bootstrap.ts";
import { type Logger } from "./log.ts";
import * as ui from "./ui.ts";
import { createInMemoryFileSystem } from "./lib/filesystem.mock.ts";

export const mockConfig: Config = {
  author: "test-user",
  paths: {
    root: "/test",
    binder: "/test/.binder",
    docs: "/test/docs",
  },
  dynamicDirectories: [],
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
  debug: () => {},
  info: () => {},
  error: () => {},
  warn: () => {},
  tag: () => mockLog,
  clone: () => mockLog,
  time: () => ({
    stop: () => {},
    [Symbol.dispose]: () => {},
  }),
};

export const mockCommandContext: CommandContext = {
  config: mockConfig,
  log: mockLog,
  ui: mockUi,
  fs: createInMemoryFileSystem(),
};

export const createMockCommandContextWithDb = (): CommandContextWithDb => {
  const db = getTestDatabase();
  return {
    ...mockCommandContext,
    db,
    kg: openKnowledgeGraph(db),
  };
};
