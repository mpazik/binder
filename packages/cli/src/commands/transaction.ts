import type { Argv } from "yargs";
import * as YAML from "yaml";
import { errorToObject, isErr, ok, tryCatch } from "@binder/utils";
import {
  normalizeEntityRef,
  TransactionInput as TransactionInputSchema,
  type TransactionRef,
} from "@binder/db";
import { bootstrapWithDb, type CommandHandlerWithDb } from "../bootstrap.ts";
import { types } from "./types.ts";

type RawTransactionData = {
  author?: string;
  nodes?: unknown[] | Record<string, unknown>;
  configurations?: unknown[] | Record<string, unknown>;
};

const transformToArray = (
  data: unknown[] | Record<string, unknown> | undefined,
): Record<string, unknown>[] => {
  if (!data) return [];
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  return Object.entries(data).map(([key, value]) => ({
    key,
    ...(typeof value === "object" && value !== null ? value : {}),
  }));
};

export const transactionCreateHandler: CommandHandlerWithDb<{
  path: string;
}> = async ({ kg, config, ui, log, args }) => {
  const path = args.path;

  if (!path) {
    log.error("Path to transaction file is required");
    process.exit(1);
  }

  const fileResult = await tryCatch(async () => {
    const bunFile = Bun.file(path);
    const text = await bunFile.text();
    return YAML.parse(text);
  }, errorToObject);

  if (isErr(fileResult)) {
    log.error("Failed to read transaction file", {
      path,
      error: fileResult.error,
    });
    process.exit(1);
  }

  const rawData = fileResult.data as RawTransactionData;
  const transactionInput = {
    author: rawData.author || config.author,
    nodes: transformToArray(rawData.nodes),
    configurations: transformToArray(rawData.configurations),
  };

  const validationResult = tryCatch(
    () => TransactionInputSchema.parse(transactionInput),
    errorToObject,
  );

  if (isErr(validationResult)) {
    log.error("Invalid transaction format", {
      error: validationResult.error,
    });
    process.exit(1);
  }

  const result = await kg.update(validationResult.data);
  if (isErr(result)) return result;

  log.info("Transaction created successfully", { path });
  ui.println("");
  ui.printTransaction(result.data);
  ui.println("");
  ui.println(
    ui.Style.TEXT_SUCCESS +
      "✓ Transaction created successfully" +
      ui.Style.TEXT_NORMAL,
  );
  return ok(undefined);
};

export const transactionReadHandler: CommandHandlerWithDb<{
  ref: TransactionRef;
}> = async ({ kg, ui, args }) => {
  const result = await kg.fetchTransaction(args.ref);
  if (isErr(result)) return result;

  ui.printData(result.data);
  return ok(undefined);
};

const TransactionCommand = types({
  command: "transaction <command>",
  aliases: ["tx"],
  describe: "create or read transactions",
  builder: (yargs: Argv) => {
    return yargs
      .command(
        types({
          command: "create [path]",
          aliases: ["add"],
          describe: "create a transaction from a YAML file",
          builder: (yargs: Argv) => {
            return yargs.positional("path", {
              describe: "path to transaction YAML file",
              type: "string",
              demandOption: true,
            });
          },
          handler: bootstrapWithDb(transactionCreateHandler),
        }),
      )
      .command(
        types({
          command: "read <ref>",
          aliases: ["fetch", "get"],
          describe: "read a transaction by reference",
          builder: (yargs: Argv) => {
            return yargs.positional("ref", {
              describe: "transaction reference (id | hash)",
              type: "string",
              demandOption: true,
              coerce: (value: string) =>
                normalizeEntityRef<"transaction">(value),
            });
          },
          handler: bootstrapWithDb(transactionReadHandler),
        }),
      )
      .demandCommand(1, "You need to specify a subcommand: create, read");
  },
  handler: async () => {},
});
export default TransactionCommand;
