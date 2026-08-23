import type { BinderCliPlugin } from "../../cli-plugin.ts";
import { createRealFileSystem } from "../../lib/filesystem.ts";
import type { FileSystem } from "../../lib/filesystem.ts";
import { JournalCommand } from "./commands.ts";
import { syncLogFromDb } from "./sync.ts";

// TODO: accept `pluginConfig.path` override. Currently uses paths.data default.
export const journalPlugin = (pluginConfig?: {
  path?: string;
  fs?: FileSystem;
}): BinderCliPlugin => ({
  name: "journal",
  register({ repo }) {
    const fs = pluginConfig?.fs ?? createRealFileSystem();

    // The writer lock serializes filesystem reconciliation across processes.
    const syncJournal = () =>
      repo.db.transaction(
        () => syncLogFromDb({ fs, kg: repo, config: repo.config }),
        { behavior: "immediate" },
      );

    // Subscriber failures cannot abort the already committed DB operation.
    repo.onCommit(undefined, syncJournal, "journal");
    repo.onRollback(undefined, syncJournal, "journal");
  },
  commands: [JournalCommand],
  // dispose: no-op. Subscriptions cleaned up on repo close.
});
