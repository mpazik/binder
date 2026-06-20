import { join } from "node:path";
import type { BinderRepoPlugin } from "@binder/repo/local";
import { UNDO_LOG_FILE } from "../../config.ts";
import { createRealFileSystem } from "../../lib/filesystem.ts";
import type { FileSystem } from "../../lib/filesystem.ts";
import { undoOnCommit, undoOnRollback } from "./handlers.ts";

/**
 * Repo-level plugin: subscribes the undo-log handlers to the kg.
 * Does NOT carry CLI commands to avoid a circular dependency with runtime.ts.
 * Use `undoPlugin()` from `./index.ts` for the full CLI plugin.
 */
export const undoRepoPlugin = (opts?: {
  fs?: FileSystem;
}): BinderRepoPlugin => ({
  name: "undo",
  register({ repo }) {
    const fs = opts?.fs ?? createRealFileSystem();
    const dataPath = repo.config.paths.data;
    const undoPath = join(dataPath, UNDO_LOG_FILE);

    repo.onCommit(undefined, (tx) => undoOnCommit(fs, undoPath, tx), "undo");
    repo.onRollback(
      undefined,
      (txs) => undoOnRollback(fs, undoPath, txs),
      "undo",
    );
  },
});
