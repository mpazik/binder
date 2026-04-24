import { join } from "node:path";
import { isErr } from "@binder/utils";
import type { BinderCliPlugin } from "../../cli-plugin.ts";
import { TRANSACTION_LOG_FILE, UNDO_LOG_FILE } from "../../config.ts";
import { createRealFileSystem } from "../../lib/filesystem.ts";
import { clearLog, logTransaction } from "../../lib/journal.ts";
import { JournalCommand } from "./commands.ts";

// TODO: accept `pluginConfig.path` override. Currently uses paths.data default.
// TODO: own transactions.jsonl path constant here instead of importing from cli config.
// TODO: inject FileSystem from context instead of constructing one here —
//       matters for tests. For now journal plugin only works with real FS.
export const journalPlugin = (_pluginConfig?: {
  path?: string;
}): BinderCliPlugin => ({
  name: "journal",
  register({ repo }) {
    const fs = createRealFileSystem();
    const dataPath = repo.config.paths.data;
    const txPath = join(dataPath, TRANSACTION_LOG_FILE);
    const undoPath = join(dataPath, UNDO_LOG_FILE);

    repo.onTransaction(undefined, async (tx) => {
      const logResult = await logTransaction(fs, txPath, tx);
      if (isErr(logResult)) {
        console.error("Journal append failed:", logResult.error);
      }
      const clearResult = await clearLog(fs, undoPath);
      if (isErr(clearResult)) {
        console.error("Undo log clear failed:", clearResult.error);
      }
    });
  },
  commands: [JournalCommand],
  // dispose: no-op. Subscriptions cleaned up on repo close.
});
