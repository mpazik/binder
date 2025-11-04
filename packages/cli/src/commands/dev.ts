import type { Argv } from "yargs";
import { errorToObject, isErr, ok, tryCatch } from "@binder/utils";
import {
  bootstrap,
  bootstrapWithDbWrite,
  type CommandHandler,
  type CommandHandlerWithDbWrite,
} from "../bootstrap.ts";
import { BINDER_DIR } from "../config.ts";
import { documentSchemaTransactionInput } from "../document/document-schema.ts";
import { mockDocumentTransactionInput } from "../document/document.mock.ts";
import { types } from "./types.ts";

export const cleanupHandler: CommandHandler = async ({ ui, fs }) => {
  const removeResult = tryCatch(() => {
    fs.rm(BINDER_DIR, { recursive: true, force: true });
  }, errorToObject);

  if (isErr(removeResult)) return removeResult;

  ui.println(".binder directory removed");
  return ok(undefined);
};

export const setupHandler: CommandHandlerWithDbWrite = async ({ kg }) => {
  const docSchemaResult = await kg.update(documentSchemaTransactionInput);
  if (isErr(docSchemaResult)) return docSchemaResult;

  const docResult = await kg.update(mockDocumentTransactionInput);
  if (isErr(docResult)) return docResult;

  return ok("Mock data created successfully");
};

const DevCommand = types({
  command: "dev <command>",
  describe: "development utilities",
  builder: (yargs: Argv) => {
    return yargs
      .command(
        types({
          command: "setup",
          describe: "remove .binder directory and initialize with mock data",
          handler: async () => {
            await bootstrap(cleanupHandler)({});
            // bootstrap again, to initialize new database instance
            return bootstrapWithDbWrite(setupHandler)({});
          },
        }),
      )
      .demandCommand(1, "You need to specify a subcommand: setup");
  },
  handler: async () => {},
});
export default DevCommand;
