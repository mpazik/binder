import type { Argv } from "yargs";
import {
  createError,
  err,
  errorToObject,
  isErr,
  ok,
  type ResultAsync,
  tryCatch,
} from "@binder/utils";
import {
  normalizeEntityRef,
  type KnowledgeGraph,
  type Transaction,
  TransactionInput,
  type TransactionRef,
} from "@binder/db";
import * as YAML from "yaml";
import {
  bootstrapWithDbRead,
  bootstrapWithDbWrite,
  type CommandHandlerWithDbRead,
  type CommandHandlerWithDbWrite,
} from "../bootstrap.ts";
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

export const loadTransactionFromFile = async (
  path: string,
  defaultAuthor: string,
): ResultAsync<TransactionInput> => {
  const fileResult = await tryCatch(async () => {
    const bunFile = Bun.file(path);
    const text = await bunFile.text();
    return YAML.parse(text);
  }, errorToObject);

  if (isErr(fileResult))
    return err(
      createError("file-read-error", "Failed to read transaction file", {
        path,
        error: fileResult.error,
      }),
    );

  const rawData = fileResult.data as RawTransactionData;
  const transactionInput = {
    author: rawData.author || defaultAuthor,
    nodes: transformToArray(rawData.nodes),
    configurations: transformToArray(rawData.configurations),
  };

  const validationResult = tryCatch(
    () => TransactionInput.parse(transactionInput),
    errorToObject,
  );

  if (isErr(validationResult))
    return err(
      createError("validation-error", "Invalid transaction format", {
        error: validationResult.error,
      }),
    );

  return ok(validationResult.data);
};

export const importTransactionFromFile = async (
  path: string,
  defaultAuthor: string,
  kg: KnowledgeGraph,
): ResultAsync<Transaction> => {
  const transactionResult = await loadTransactionFromFile(path, defaultAuthor);
  if (isErr(transactionResult)) return transactionResult;

  return kg.update(transactionResult.data);
};

export const transactionCreateHandler: CommandHandlerWithDbWrite<{
  path: string;
}> = async ({ kg, config, ui, log, args }) => {
  const path = args.path;

  if (!path) {
    log.error("Path to transaction file is required");
    process.exit(1);
  }

  const transactionResult = await loadTransactionFromFile(path, config.author);

  if (isErr(transactionResult)) {
    log.error("Failed to load transaction", {
      path,
      error: transactionResult.error,
    });
    process.exit(1);
  }

  const result = await kg.update(transactionResult.data);
  if (isErr(result)) return result;

  log.info("Transaction created successfully", { path });
  ui.block(() => {
    ui.printTransaction(result.data);
  });
  ui.success("Transaction created successfully");
  return ok(undefined);
};

export const transactionReadHandler: CommandHandlerWithDbRead<{
  ref: TransactionRef;
}> = async ({ kg, ui, args }) => {
  const result = await kg.fetchTransaction(args.ref);
  if (isErr(result)) return result;

  ui.printData(result.data);
  return ok(undefined);
};

export const transactionRollbackHandler: CommandHandlerWithDbWrite<{
  count: number;
}> = async ({ kg, ui, log, args }) => {
  const versionResult = await kg.version();
  if (isErr(versionResult)) return versionResult;

  const currentId = versionResult.data.id;
  if (currentId === 1)
    return err(
      createError(
        "invalid-rollback",
        "Cannot rollback the genesis transaction",
      ),
    );

  if (args.count > currentId - 1)
    return err(
      createError(
        "invalid-rollback",
        `Cannot rollback ${args.count} transactions, only ${currentId - 1} available`,
      ),
    );

  const transactionsToRollback: Transaction[] = [];
  for (let i = 0; i < args.count; i++) {
    const txId = (currentId - i) as TransactionRef;
    const txResult = await kg.fetchTransaction(txId);
    if (isErr(txResult)) return txResult;
    transactionsToRollback.push(txResult.data);
  }

  ui.printTransactions(
    transactionsToRollback,
    `Rolling back ${args.count} transaction(s)`,
  );

  const rollbackResult = await kg.rollback(args.count, currentId);
  if (isErr(rollbackResult)) return rollbackResult;

  log.info("Rolled back successfully", { count: args.count });
  ui.success("Rolled back successfully");
  return ok(undefined);
};

const TransactionCommand = types({
  command: "transaction <command>",
  aliases: ["tx"],
  describe: "create transactions",
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
          handler: bootstrapWithDbWrite(transactionCreateHandler),
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
          handler: bootstrapWithDbRead(transactionReadHandler),
        }),
      )
      .command(
        types({
          command: "rollback [count]",
          describe: "rollback the last N transactions",
          builder: (yargs: Argv) => {
            return yargs.positional("count", {
              describe: "number of transactions to rollback",
              type: "number",
              default: 1,
            });
          },
          handler: bootstrapWithDbWrite(transactionRollbackHandler),
        }),
      )
      .demandCommand(
        1,
        "You need to specify a subcommand: create, read, rollback",
      );
  },
  handler: async () => {},
});
export default TransactionCommand;
