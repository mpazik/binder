import { fileURLToPath } from "node:url";
import { join } from "node:path";
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
            await onFilesUpdated(
              relativePaths.map((path) =>
                resolveRelativePath(path, runtime.config.paths),
              ),
            );
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
      const entityContextCache = createEntityContextCache(
        runtime.log,
        runtime.kg,
      );

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
    findWorkspaceForDocument: (
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
    },
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
