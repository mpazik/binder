import { join } from "node:path";
import type { CommandModule } from "yargs";
import type { BinderCliPlugin } from "../../cli-plugin.ts";
import { UNDO_LOG_FILE } from "../../config.ts";
import { createRealFileSystem } from "../../lib/filesystem.ts";
import type { FileSystem } from "../../lib/filesystem.ts";
import { undoOnCommit, undoOnRollback } from "./handlers.ts";
import { UndoCommand, RedoCommand } from "./commands.ts";

export const undoPlugin = (opts?: { fs?: FileSystem }): BinderCliPlugin => ({
  name: "undo",
  register({ repo }) {
    const fs = opts?.fs ?? createRealFileSystem();
    const dataPath = repo.config.paths.data;
    const undoPath = join(dataPath, UNDO_LOG_FILE);

    // The undo-log staging/clearing side effects must run exactly once in the
    // originating process, same model as the journal plugin.
    repo.onCommit(undefined, (tx) => undoOnCommit(fs, undoPath, tx), "undo");
    repo.onRollback(
      undefined,
      (txs) => undoOnRollback(fs, undoPath, txs),
      "undo",
    );
  },
  commands: [UndoCommand as CommandModule, RedoCommand as CommandModule],
});
