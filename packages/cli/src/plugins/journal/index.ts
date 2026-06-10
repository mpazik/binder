import { join } from "node:path";
import { fail, isErr } from "@binder/utils";
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

    // Writer side effect: must run exactly once, in the originating process.
    // Failures surface via the repo's subscriber error reporter and never
    // abort the commit — transactions.jsonl is a derived artifact repairable
    // with `binder journal repair`.
    repo.onCommit(
      undefined,
      async (tx) => {
        const logResult = await logTransaction(fs, txPath, tx);
        const clearResult = await clearLog(fs, undoPath);
        if (isErr(logResult) && isErr(clearResult)) {
          return fail(
            "journal-write-failed",
            "Journal append and undo-log clear both failed",
            { data: { append: logResult.error, clear: clearResult.error } },
          );
        }
        return isErr(logResult) ? logResult : clearResult;
      },
      "journal",
    );
  },
  commands: [JournalCommand],
  // dispose: no-op. Subscriptions cleaned up on repo close.
});
