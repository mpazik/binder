import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import type { Connection } from "vscode-languageserver/node";
import { isErr } from "@binder/utils";
import type { TelemetryState } from "../telemetry.ts";
import {
  initializeFullRuntime,
  type RuntimeContextInit,
  type RuntimeContextWithDb,
} from "../runtime.ts";
import { BINDER_DIR, resolveRelativePath } from "../config.ts";
import type { Logger } from "../log.ts";
import {
  createEntityContextCache,
  type EntityContextCache,
} from "./entity-context.ts";
import { createDocumentCache, type DocumentCache } from "./document-context.ts";

export type WorkspaceEntry = {
  runtime: RuntimeContextWithDb;
  documentCache: DocumentCache;
  entityContextCache: EntityContextCache;
  close: () => void;
};

const SCAN_SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  ".git",
]);

const shouldSkipDir = (name: string): boolean =>
  name.startsWith(".") || SCAN_SKIP_DIRS.has(name);

export type WorkspaceManager = {
  initializeWorkspace: (rootUri: string) => Promise<WorkspaceEntry | undefined>;
  discoverWorkspaces: (
    folderUri: string,
    explicitPaths?: string[],
  ) => Promise<void>;
  disposeWorkspace: (rootUri: string) => Promise<void>;
  disposeWorkspacesUnder: (folderUri: string) => Promise<void>;
  findWorkspaceForDocument: (documentUri: string) => WorkspaceEntry | undefined;
  isBinderWorkspace: (rootUri: string) => Promise<boolean>;
  disposeAll: () => Promise<void>;
  getStats: () => { workspaceCount: number; workspaces: string[] };
};

export const createWorkspaceManager = (
  minimalContext: RuntimeContextInit,
  log: Logger,
  onFilesUpdated: (absolutePaths: string[]) => Promise<void>,
): WorkspaceManager => {
  const workspaces = new Map<string, WorkspaceEntry>();
  // Maps VS Code folder path -> set of binder workspace root paths discovered under it
  const folderToWorkspaces = new Map<string, Set<string>>();

  const isBinderWorkspace = async (rootUri: string): Promise<boolean> => {
    const rootPath = fileURLToPath(rootUri);
    const binderDir = join(rootPath, BINDER_DIR);
    return minimalContext.fs.exists(binderDir);
  };

  const initializeWorkspace = async (
    rootUri: string,
  ): Promise<WorkspaceEntry | undefined> => {
    const rootPath = fileURLToPath(rootUri);

    if (workspaces.has(rootPath)) {
      return workspaces.get(rootPath);
    }

    log.info("Initializing workspace", { rootPath });

    const runtimeResult = await initializeFullRuntime(
      { ...minimalContext, silent: true, logFile: "lsp.log" },
      rootPath,
      {
        onFilesUpdated: async (relativePaths: string[]) => {
          entityContextCache.invalidateAll();
          const absolutePaths = relativePaths.map((path) =>
            resolveRelativePath(path, runtime.config.paths),
          );
          runtime.log.info("Files rendered to disk", {
            fileCount: absolutePaths.length,
            paths: absolutePaths,
          });
          await onFilesUpdated(absolutePaths);
        },
      },
    );

    if (isErr(runtimeResult)) {
      log.error("Failed to initialize workspace", {
        rootPath,
        error: runtimeResult.error,
      });
      return undefined;
    }

    const { runtime, close } = runtimeResult.data;
    const documentCache = createDocumentCache(runtime.log);
    const entityContextCache = createEntityContextCache(runtime);

    const entry: WorkspaceEntry = {
      runtime,
      documentCache,
      entityContextCache,
      close,
    };
    workspaces.set(rootPath, entry);

    log.info("Workspace initialized", {
      rootPath,
      docsPath: runtime.config.paths.docs,
      binderPath: runtime.config.paths.binder,
    });

    return entry;
  };

  const disposeWorkspace = async (rootUri: string): Promise<void> => {
    const rootPath = fileURLToPath(rootUri);
    const entry = workspaces.get(rootPath);
    if (!entry) return;

    log.info("Disposing workspace", { rootPath });
    entry.close();
    workspaces.delete(rootPath);
  };

  const findWorkspaceForDocument = (
    documentUri: string,
  ): WorkspaceEntry | undefined => {
    const filePath = fileURLToPath(documentUri);

    let bestMatch: WorkspaceEntry | undefined;
    let bestLength = 0;

    for (const [, entry] of workspaces) {
      const { paths } = entry.runtime.config;

      if (
        filePath.startsWith(paths.docs) ||
        filePath.startsWith(paths.binder)
      ) {
        // Longest-prefix match: prefer deeper workspace roots
        const matchLength = Math.max(paths.docs.length, paths.binder.length);
        if (matchLength > bestLength) {
          bestLength = matchLength;
          bestMatch = entry;
        }
      }
    }
    return bestMatch;
  };

  const trackWorkspaceUnderFolder = (
    folderPath: string,
    workspacePath: string,
  ): void => {
    let paths = folderToWorkspaces.get(folderPath);
    if (!paths) {
      paths = new Set();
      folderToWorkspaces.set(folderPath, paths);
    }
    paths.add(workspacePath);
  };

  const discoverWorkspaces = async (
    folderUri: string,
    explicitPaths?: string[],
  ): Promise<void> => {
    const folderPath = fileURLToPath(folderUri);

    if (explicitPaths && explicitPaths.length > 0) {
      // Use explicit paths relative to the folder
      for (const rel of explicitPaths) {
        const absPath = join(folderPath, rel);
        const uri = pathToFileURL(absPath).href;
        if (await isBinderWorkspace(uri)) {
          await initializeWorkspace(uri);
          trackWorkspaceUnderFolder(folderPath, absPath);
        } else {
          log.info("Explicit workspace path has no .binder", { path: absPath });
        }
      }
      return;
    }

    // Check root
    if (await isBinderWorkspace(folderUri)) {
      await initializeWorkspace(folderUri);
      trackWorkspaceUnderFolder(folderPath, folderPath);
    }

    // Scan immediate subdirectories (depth 1)
    const result = await minimalContext.fs.readdir(folderPath);
    if (isErr(result)) {
      log.error("Failed to scan subdirectories", {
        folderPath,
        error: result.error,
      });
      return;
    }
    const entries = result.data;
    for (const entry of entries) {
      if (!entry.isDirectory || shouldSkipDir(entry.name)) continue;

      const subPath = join(folderPath, entry.name);
      const subUri = pathToFileURL(subPath).href;
      if (await isBinderWorkspace(subUri)) {
        await initializeWorkspace(subUri);
        trackWorkspaceUnderFolder(folderPath, subPath);
      }
    }
  };

  const disposeWorkspacesUnder = async (folderUri: string): Promise<void> => {
    const folderPath = fileURLToPath(folderUri);
    const paths = folderToWorkspaces.get(folderPath);
    if (!paths) return;

    for (const wsPath of paths) {
      const wsUri = pathToFileURL(wsPath).href;
      await disposeWorkspace(wsUri);
    }
    folderToWorkspaces.delete(folderPath);
  };

  return {
    initializeWorkspace,
    discoverWorkspaces,
    disposeWorkspace,
    disposeWorkspacesUnder,
    findWorkspaceForDocument,
    isBinderWorkspace,
    disposeAll: async (): Promise<void> => {
      log.info("Disposing all workspaces", { count: workspaces.size });

      for (const [rootPath] of workspaces) {
        await disposeWorkspace(pathToFileURL(rootPath).href);
      }
      folderToWorkspaces.clear();
    },
    getStats: () => ({
      workspaceCount: workspaces.size,
      workspaces: Array.from(workspaces.keys()),
    }),
  };
};

/**
 * In-process counters for high-frequency LSP actions. Aggregated here
 * instead of emitted per-invocation because code actions, hovers, completion
 * requests and diagnostic pulls fire dozens of times per minute during normal
 * editing. Counts are attached to the `lsp.session` event at shutdown.
 */
export type LspCounters = {
  hover_count: number;
  completion_count: number;
  code_action_count: number;
  diagnostics_count: number;
  definition_count: number;
  save_sync_count: number;
};

export type LspCounterKey = keyof LspCounters;

export const createLspCounters = (): LspCounters => ({
  hover_count: 0,
  completion_count: 0,
  code_action_count: 0,
  diagnostics_count: 0,
  definition_count: 0,
  save_sync_count: 0,
});

export type WorkspaceCtx = {
  connection: Connection;
  workspaceManager: WorkspaceManager;
  log: Logger;
  telemetry: TelemetryState;
  counters: LspCounters;
};

export const resolveWorkspace = (
  ctx: WorkspaceCtx,
  uri: string,
  eventName: string,
): WorkspaceEntry | undefined => {
  const workspace = ctx.workspaceManager.findWorkspaceForDocument(uri);
  if (!workspace) {
    ctx.log.debug(`${eventName}: not in any Binder workspace`, { uri });
  }
  return workspace;
};

type HasDocumentUri = { document: { uri: string } };

export const withWorkspaceContext =
  <T extends HasDocumentUri>(
    ctx: WorkspaceCtx,
    eventName: string,
    handler: (
      ctx: WorkspaceCtx,
      event: T,
      workspace: WorkspaceEntry,
    ) => Promise<void>,
    options?: { telemetry?: LspCounterKey },
  ) =>
  async (event: T): Promise<void> => {
    const workspace = resolveWorkspace(ctx, event.document.uri, eventName);
    if (!workspace) return;
    if (options?.telemetry) {
      ctx.counters[options.telemetry] += 1;
    }
    await handler(ctx, event, workspace);
  };
