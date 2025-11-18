import type { Argv } from "yargs";
import { isErr, ok } from "@binder/utils";
import {
  bootstrapWithDbWrite,
  type CommandHandlerWithDbWrite,
} from "../bootstrap.ts";
import { renderDocs } from "../document/repository.ts";
import { synchronizeModifiedFiles } from "../document/synchronizer.ts";
import { loadNavigation } from "../document/navigation.ts";
import { modifiedFiles } from "../lib/snapshot.ts";
import { types } from "./types.ts";

export const docsRenderHandler: CommandHandlerWithDbWrite = async (context) => {
  const { ui } = context;
  const result = await renderDocs(context);
  if (isErr(result)) return result;

  ui.println("Documentation rendered successfully");
  return ok(undefined);
};

export const docsSyncHandler: CommandHandlerWithDbWrite<{
  path?: string;
}> = async ({ kg, fs, ui, config, args, db }) => {
  const navigationResult = await loadNavigation(fs, config.paths.binder);
  if (isErr(navigationResult)) return navigationResult;

  const modifiedFilesResult = await modifiedFiles(
    db,
    fs,
    config.paths.docs,
    args.path,
  );
  if (isErr(modifiedFilesResult)) return modifiedFilesResult;

  const actionableFiles = modifiedFilesResult.data.filter(
    (file) => file.type === "untracked" || file.type === "updated",
  );

  if (actionableFiles.length === 0) {
    ui.println("No changes detected");
    return ok(undefined);
  }

  const syncResult = await synchronizeModifiedFiles(
    fs,
    kg,
    config,
    navigationResult.data,
    { fields: {}, types: {} },
    actionableFiles,
  );
  if (isErr(syncResult)) return syncResult;

  if (syncResult.data === null) {
    ui.println("No changes detected");
    return ok(undefined);
  }

  const updateResult = await kg.update(syncResult.data);
  if (isErr(updateResult)) return updateResult;

  ui.block(() => {
    ui.printTransaction(updateResult.data);
  });
  ui.success(
    `Synchronized ${actionableFiles.length} file${actionableFiles.length === 1 ? "" : "s"}`,
  );
  return ok(undefined);
};

const DocsCommand = types({
  command: "docs <command>",
  describe: "manage documentation",
  builder: (yargs: Argv) => {
    return yargs
      .command(
        types({
          command: "render",
          describe: "render documents to markdown files",
          handler: bootstrapWithDbWrite(docsRenderHandler),
        }),
      )
      .command(
        types({
          command: "sync [path]",
          describe:
            "synchronize files with the knowledge graph (file, directory, or all modified files)",
          builder: (yargs: Argv) => {
            return yargs.positional("path", {
              describe:
                "path to file or directory (omit to sync all modified files)",
              type: "string",
              demandOption: false,
            });
          },
          handler: bootstrapWithDbWrite(docsSyncHandler),
        }),
      )
      .demandCommand(1, "You need to specify a subcommand: render, sync");
  },
  handler: async () => {},
});
export default DocsCommand;
