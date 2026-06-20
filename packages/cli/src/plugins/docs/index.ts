import { isErr, isObjectEmpty, okVoid, type ResultAsync } from "@binder/utils";
import type { KnowledgeGraph, Transaction } from "@binder/repo";
import type { BinderCliPlugin } from "../../cli-plugin.ts";
import { renderDocs, type RenderDocsCtx } from "../../document/repository.ts";
import { DocsCommand } from "./commands.ts";

/**
 * Runtime context the docs plugin needs to render. Injected lazily by the
 * caller (runtime.ts) because views cache, db, and logger are constructed
 * after `openRepo` returns, while plugins register during it. The getter is
 * only invoked when a transaction commits or rolls back, well after init.
 */
export type DocsPluginContext = Omit<RenderDocsCtx, "kg" | "force"> & {
  /** Notified with workspace-relative paths of re-rendered files (LSP). */
  onFilesUpdated?: (paths: string[]) => void | Promise<void>;
  /** Invalidates nav/view caches; called before render when configs change. */
  invalidateCaches?: () => void;
};

// Writer-side render: re-renders docs after each committed transaction or
// rollback, in the originating process. Registered after the journal and undo
// plugins so the transaction log is reconciled before files change on disk.
// Render failures surface via the repo's subscriber error reporter and never
// abort the commit/rollback.
export const docsPlugin = (options?: {
  context?: () => DocsPluginContext;
}): BinderCliPlugin => ({
  name: "docs",
  register({ repo }) {
    const getContext = options?.context;
    // Without an injected context (e.g. instantiated at CLI parse time just
    // for command listing) there is nothing to render with.
    if (!getContext) return;

    const renderAndNotify = async (
      configsChanged: boolean,
    ): ResultAsync<void> => {
      const ctx = getContext();
      // Render reads views through the cache; invalidate before rendering so
      // config changes (views, navigation) take effect immediately.
      if (configsChanged) ctx.invalidateCaches?.();

      const renderResult = await renderDocs({
        ...ctx,
        kg: repo as KnowledgeGraph,
      });
      if (isErr(renderResult)) return renderResult;

      if (ctx.onFilesUpdated && renderResult.data.modifiedPaths.length > 0) {
        await ctx.onFilesUpdated(renderResult.data.modifiedPaths);
      }
      return okVoid;
    };

    repo.onCommit(
      undefined,
      (tx) => renderAndNotify(!isObjectEmpty(tx.configs)),
      "docs",
    );
    repo.onRollback(
      undefined,
      (transactions: Transaction[]) =>
        renderAndNotify(transactions.some((tx) => !isObjectEmpty(tx.configs))),
      "docs",
    );
  },
  commands: [DocsCommand],
  // dispose: no-op. Subscriptions cleaned up on repo close.
});
