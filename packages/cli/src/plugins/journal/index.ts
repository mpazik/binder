import { join } from "node:path";
import type { BinderCliPlugin } from "../../cli-plugin.ts";
import { TRANSACTION_LOG_FILE } from "../../config.ts";
import { createRealFileSystem } from "../../lib/filesystem.ts";
import type { FileSystem } from "../../lib/filesystem.ts";
import { journalOnCommit, journalOnRollback } from "./handlers.ts";
import { JournalCommand } from "./commands.ts";

// TODO: accept `pluginConfig.path` override. Currently uses paths.data default.
// TODO: own transactions.jsonl path constant here instead of importing from cli config.
export const journalPlugin = (pluginConfig?: {
  path?: string;
  fs?: FileSystem;
}): BinderCliPlugin => ({
  name: "journal",
  register({ repo }) {
    const fs = pluginConfig?.fs ?? createRealFileSystem();
    const dataPath = repo.config.paths.data;
    const txPath = join(dataPath, TRANSACTION_LOG_FILE);

    // Writer side effects: must run exactly once, in the originating process.
    // Failures surface via the repo's subscriber error reporter and never
    // abort the commit/rollback — transactions.jsonl is a derived artifact
    // repairable with `binder journal repair`. Both handlers verify against the
    // log tail hash so they are idempotent (see handlers.ts).
    repo.onCommit(
      undefined,
      (tx) => journalOnCommit(fs, txPath, tx),
      "journal",
    );
    repo.onRollback(
      undefined,
      (transactions) => journalOnRollback(fs, txPath, transactions),
      "journal",
    );
  },
  commands: [JournalCommand],
  // dispose: no-op. Subscriptions cleaned up on repo close.
});
