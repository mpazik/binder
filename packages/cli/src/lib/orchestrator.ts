import type { KnowledgeGraph, KnowledgeGraphCallbacks } from "@binder/repo";
import { isErr } from "@binder/utils";
import { renderDocs } from "../document/repository.ts";
import type { RuntimeContextWithDb } from "../runtime.ts";

export type OrchestratorCtx = Pick<
  RuntimeContextWithDb,
  "db" | "fs" | "log" | "config" | "views"
>;

export type OrchestratorCallbacks = KnowledgeGraphCallbacks & {
  onFilesUpdated?: (paths: string[]) => void;
};

// Transitional — will become plugins. Concurrency is handled by SQLite (WAL +
// busy_timeout); there is no separate workspace file lock.
export const buildOrchestratorCallbacks =
  (
    ctx: OrchestratorCtx,
    callbacks: OrchestratorCallbacks,
  ): ((kg: KnowledgeGraph) => KnowledgeGraphCallbacks) =>
  (kg: KnowledgeGraph): KnowledgeGraphCallbacks => {
    const { log } = ctx;

    const renderAndNotify = async (context: string) => {
      const renderResult = await renderDocs({ ...ctx, kg });
      if (isErr(renderResult)) {
        log.error(`Failed to re-render docs after ${context}`, {
          error: renderResult.error,
        });
        return;
      }

      if (
        callbacks.onFilesUpdated &&
        renderResult.data.modifiedPaths.length > 0
      ) {
        await callbacks.onFilesUpdated(renderResult.data.modifiedPaths);
      }
    };

    return {
      afterCommit: async (transaction) => {
        await callbacks.afterCommit?.(transaction);
        await renderAndNotify("transaction");
      },
      afterRollback: async (transactions, count) => {
        await callbacks.afterRollback?.(transactions, count);
        await renderAndNotify("rollback");
      },
    };
  };
