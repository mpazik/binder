import { rmSync } from "fs";
import type { Argv } from "yargs";
import { errorToObject, isErr, ok, tryCatch } from "@binder/utils";
import {
  bootstrap,
  bootstrapWithDb,
  type CommandHandler,
  type CommandHandlerWithDb,
} from "../bootstrap.ts";
import { BINDER_DIR } from "../config.ts";
import { documentSchemaTransactionInput } from "../document/document-schema.ts";
import { mockDocumentTransactionInput } from "../document/document.mock.ts";
import { types } from "./types.ts";

export const cleanupHandler: CommandHandler = async ({ ui }) => {
  const removeResult = tryCatch(() => {
    rmSync(BINDER_DIR, { recursive: true, force: true });
  }, errorToObject);

  if (isErr(removeResult)) return removeResult;

  ui.println(".binder directory removed");
  return ok(undefined);
};

export const setupHandler: CommandHandlerWithDb = async ({ kg }) => {
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
            return bootstrapWithDb(setupHandler)({});
          },
        }),
      )
      .demandCommand(1, "You need to specify a subcommand: setup");
  },
  handler: async () => {},
});
export default DevCommand;
