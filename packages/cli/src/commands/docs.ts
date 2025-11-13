import type { Argv } from "yargs";
import { errorToObject, isErr, ok, tryCatch } from "@binder/utils";
import {
  bootstrapWithDbWrite,
  type CommandHandlerWithDbWrite,
} from "../bootstrap.ts";
import { renderDocs } from "../document/repository.ts";
import { synchronizeFile } from "../document/synchronizer.ts";
import { types } from "./types.ts";

export const docsRenderHandler: CommandHandlerWithDbWrite = async ({
  kg,
  fs,
  ui,
  config,
  log,
}) => {
  const result = await renderDocs(
    kg,
    fs,
    log,
    config.paths.docs,
    config.paths.binder,
  );
  if (isErr(result)) return result;

  ui.println("Documentation rendered successfully");
  return ok(undefined);
};

export const docsSyncHandler: CommandHandlerWithDbWrite<{
  filePath: string;
}> = async ({ kg, fs, ui, config, args }) => {
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
    kg,
    config,
    fs,
    fileResult.data,
    args.filePath,
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
  ui.success("File synchronized successfully");
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
          command: "sync <filePath>",
          describe: "synchronize a file with the knowledge graph",
          builder: (yargs: Argv) => {
            return yargs.positional("filePath", {
              describe: "path to the markdown file to synchronize",
              type: "string",
              demandOption: true,
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
