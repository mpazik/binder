import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { Connection } from "vscode-languageserver/node";
import { isErr } from "@binder/utils";
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

export type WorkspaceManager = {
  initializeWorkspace: (rootUri: string) => Promise<WorkspaceEntry | undefined>;
  disposeWorkspace: (rootUri: string) => Promise<void>;
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

    for (const [, entry] of workspaces) {
      const { paths } = entry.runtime.config;

      if (
        filePath.startsWith(paths.docs) ||
        filePath.startsWith(paths.binder)
      ) {
        return entry;
      }
    }
    return undefined;
  };

  return {
    initializeWorkspace: async (
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
    },
    disposeWorkspace,
    findWorkspaceForDocument,
    isBinderWorkspace: async (rootUri: string): Promise<boolean> => {
      const rootPath = fileURLToPath(rootUri);
      const binderDir = join(rootPath, BINDER_DIR);
      return minimalContext.fs.exists(binderDir);
    },
    disposeAll: async (): Promise<void> => {
      log.info("Disposing all workspaces", { count: workspaces.size });

      for (const [rootPath] of workspaces) {
        await disposeWorkspace(`file://${rootPath}`);
      }
    },
    getStats: () => ({
      workspaceCount: workspaces.size,
      workspaces: Array.from(workspaces.keys()),
    }),
  };
};

export type WorkspaceCtx = {
  connection: Connection;
  workspaceManager: WorkspaceManager;
  log: Logger;
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
  ) =>
  async (event: T): Promise<void> => {
    const workspace = resolveWorkspace(ctx, event.document.uri, eventName);
    if (!workspace) return;
    await handler(ctx, event, workspace);
  };
