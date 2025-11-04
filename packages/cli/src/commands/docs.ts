import type { Argv } from "yargs";
import {
  errorToObject,
  isErr,
  mapObjectValues,
  ok,
  omit,
  tryCatch,
} from "@binder/utils";
import { systemFields } from "@binder/db";
import { bootstrapWithDb, type CommandHandlerWithDb } from "../bootstrap.ts";
import { renderDocs } from "../document/repository.ts";
import { synchronizeFile } from "../document/synchronizer.ts";
import { types } from "./types.ts";

export const docsRenderHandler: CommandHandlerWithDb = async ({
  kg,
  ui,
  config,
}) => {
  const result = await renderDocs(
    kg,
    config.paths.docs,
    config.dynamicDirectories,
  );
  if (isErr(result)) return result;

  ui.println("Documentation rendered successfully");
  return ok(undefined);
};

export const docsSyncHandler: CommandHandlerWithDb<{
  filePath: string;
}> = async ({ kg, ui, config, args }) => {
  const fileResult = await tryCatch(async () => {
    const bunFile = Bun.file(args.filePath);
    if (!(await bunFile.exists())) {
      return null;
    }
    return bunFile.text();
  }, errorToObject);

  if (isErr(fileResult)) return fileResult;

  if (fileResult.data === null) {
    ui.error(`File not found: ${args.filePath}`);
    return ok(undefined);
  }

  const syncResult = await synchronizeFile(
    fileResult.data,
    args.filePath,
    config,
    kg,
  );
  if (isErr(syncResult)) return syncResult;

  if (syncResult.data === null) {
    ui.println("No changes detected");
    return ok(undefined);
  }

  const updateResult = await kg.update(syncResult.data);
  if (isErr(updateResult)) return updateResult;

  ui.println("");
  ui.printTransaction(updateResult.data);
  ui.println("");
  ui.println(
    ui.Style.TEXT_SUCCESS +
      "✓ File synchronized successfully" +
      ui.Style.TEXT_NORMAL,
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
          handler: bootstrapWithDb(docsRenderHandler),
        }),
      )
      .command(
        types({
          command: "sync <filePath>",
          describe: "synchronize a file with the knowledge graph",
          builder: (yargs: Argv) => {
            return yargs.positional("filePath", {
              describe: "path to the markdown file to synchronize",
              type: "string",
              demandOption: true,
            });
          },
          handler: bootstrapWithDb(docsSyncHandler),
        }),
      )
      .demandCommand(1, "You need to specify a subcommand: render, sync");
  },
  handler: async () => {},
});
export default DocsCommand;
