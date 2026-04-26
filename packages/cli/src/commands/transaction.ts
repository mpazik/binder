import { basename, extname, join } from "path";
import type { Argv } from "yargs";
import { fail, includes, isErr, ok, okVoid, wrapError } from "@binder/utils";
import {
  normalizeEntityRef,
  normalizeTransactionInput,
  type Transaction,
  type TransactionInput,
  type TransactionRef,
  transactionToInput,
  TransactionInputSchema,
} from "@binder/repo";
import { type CommandHandlerWithDb, runtimeWithDb } from "../runtime.ts";
import { squashTransactions } from "../lib/orchestrator.ts";
import { readLastTransactions } from "../lib/journal.ts";
import { TRANSACTION_LOG_FILE } from "../config.ts";
import {
  detectFileFormat,
  parseTransactionInputContent,
} from "../utils/parse.ts";
import { isStdinPiped, readStdinAsArray } from "../cli/stdin.ts";
import { types } from "../cli/types.ts";
import {
  confirmProtected,
  dryRunOption,
  itemFormatOption,
  selectionOptions,
  type TxMetadataArgs,
  withTxMetadata,
  yesOption,
} from "../cli/options.ts";
import { resolveTransactionDisplayKeys } from "../cli/ui.ts";
import {
  serialize,
  serializeFormats,
  type SerializeItemFormat,
} from "../utils/serialize.ts";
import { applySelection, type SelectionArgs } from "../utils/selection.ts";
import { withPager } from "../cli/pager.ts";

const transactionInputSummary = (input: TransactionInput): string =>
  [
    input.records?.length && `${input.records.length} record(s)`,
    input.configs?.length && `${input.configs.length} config(s)`,
  ]
    .filter(Boolean)
    .join(", ");

export const transactionImportHandler: CommandHandlerWithDb<
  {
    files?: string[];
    dryRun?: boolean;
  } & TxMetadataArgs &
    SelectionArgs
> = async ({ kg, config, ui, log, fs, args }) => {
  let allInputs: (TransactionInput & { _source?: string })[] = [];
  const files = args.files ?? [];

  if (files.length > 0 && isStdinPiped())
    return fail(
      "conflicting-input",
      "Cannot combine stdin with file arguments",
    );

  if (files.length === 0 && isStdinPiped()) {
    const parseResult = await readStdinAsArray(
      TransactionInputSchema,
      undefined,
      (raw) => ({
        ...(raw as object),
        author: (raw as { author?: string }).author ?? config.author,
      }),
    );
    if (isErr(parseResult)) return parseResult;
    allInputs.push(
      ...parseResult.data.map((input) => ({ ...input, _source: "stdin" })),
    );
  } else if (files.length === 0) {
    return fail("no-input", "Provide file path(s) or pipe content via stdin");
  } else {
    for (const path of files) {
      const contentResult = await fs.readFile(path);
      if (isErr(contentResult)) return contentResult;

      const parseResult = parseTransactionInputContent(
        contentResult.data,
        detectFileFormat(path),
        config.author,
      );
      if (isErr(parseResult)) return parseResult;
      allInputs.push(
        ...parseResult.data.map((input) => ({
          ...input,
          _source: basename(path, extname(path)),
        })),
      );
    }
  }

  if (allInputs.length === 0)
    return fail(
      "no-transactions",
      "No transactions found in the provided files",
    );

  allInputs = applySelection(allInputs, args);

  if (allInputs.length === 0)
    return fail(
      "no-transactions-after-selection",
      "No transactions remaining after applying selection",
    );

  ui.heading(`Importing ${allInputs.length} transaction(s)`);
  for (const input of allInputs) {
    const summary = transactionInputSummary(input);
    const detail = summary ? `, ${summary}` : "";
    ui.info(`  author "${input.author}"${detail}`);
  }

  if (args.dryRun) {
    ui.block(() => {
      ui.info("Dry run complete - no changes made");
    });
    return okVoid;
  }

  const cliMeta = args.txMeta;

  const results: Transaction[] = [];
  for (let i = 0; i < allInputs.length; i++) {
    const input = allInputs[i]!;
    const source = input._source;
    delete (input as Record<string, unknown>)._source;

    const autoTag = source ? `import-${source}` : undefined;
    const autoMessage = source
      ? `Imported from ${source}`
      : "Imported via stdin";

    const mergedTags = [
      ...(autoTag ? [autoTag] : []),
      ...(cliMeta.tags ?? []),
      ...(input.tags ?? []),
    ];

    const enrichedInput: TransactionInput = {
      ...input,
      ...(mergedTags.length > 0 && { tags: [...new Set(mergedTags)] }),
      message: input.message ?? cliMeta.message ?? autoMessage,
      source: input.source ?? cliMeta.source,
      channel: input.channel ?? cliMeta.channel,
    };

    const result = await kg.update(enrichedInput);
    if (isErr(result)) {
      const summary = transactionInputSummary(input);
      const suffix = summary ? ` (${summary})` : "";
      return wrapError(
        result,
        `Failed to import transaction ${i + 1}${suffix}`,
        {
          data: { transactionIndex: i + 1, author: input.author },
        },
      );
    }
    results.push(result.data);
  }

  log.info("Import completed successfully", { count: results.length });

  const resolved = await resolveTransactionDisplayKeys(kg, results);
  ui.block(() => {
    ui.success(`Imported ${results.length} transaction(s) successfully`);
    for (const tx of resolved) {
      ui.printRawTransaction(tx, "oneline");
    }
  });

  const recordCount = allInputs.reduce(
    (sum, input) => sum + (input.records?.length ?? 0),
    0,
  );
  const configCount = allInputs.reduce(
    (sum, input) => sum + (input.configs?.length ?? 0),
    0,
  );
  return ok({
    telemetry: {
      transaction_count: results.length,
      record_count: recordCount,
      config_count: configCount,
    },
  });
};

export const transactionReadHandler: CommandHandlerWithDb<{
  ref: TransactionRef;
  format?: SerializeItemFormat;
}> = async ({ kg, ui, args }) => {
  const result = await kg.fetchTransaction(args.ref);
  if (isErr(result)) return result;

  ui.printData(result.data, args.format);
  return okVoid;
};

export const transactionRollbackHandler: CommandHandlerWithDb<{
  count: number;
  yes?: boolean;
}> = async ({ kg, ui, log, args }) => {
  const versionResult = await kg.version();
  if (isErr(versionResult)) return versionResult;

  const currentId = versionResult.data.id;
  if (currentId === 1)
    return fail("invalid-rollback", "Cannot rollback the genesis transaction");

  if (args.count > currentId - 1)
    return fail(
      "invalid-rollback",
      `Cannot rollback ${args.count} transactions, only ${currentId - 1} available`,
    );

  const transactionsToRollback: Transaction[] = [];
  for (let i = 0; i < args.count; i++) {
    const txId = (currentId - i) as TransactionRef;
    const txResult = await kg.fetchTransaction(txId);
    if (isErr(txResult)) return txResult;
    transactionsToRollback.push(txResult.data);
  }

  ui.heading(`Rolling back ${args.count} transaction(s)`);

  await ui.printTransactions(kg, transactionsToRollback, "concise");

  const confirmResult = await confirmProtected(
    ui,
    args,
    "Do you want to proceed with rollback? (yes/no): ",
  );
  if (isErr(confirmResult)) return confirmResult;
  if (!confirmResult.data) {
    ui.info("Rollback cancelled");
    return okVoid;
  }

  const rollbackResult = await kg.rollback(args.count, currentId);
  if (isErr(rollbackResult)) return rollbackResult;

  log.info("Rolled back successfully", { count: args.count });
  ui.success("Rolled back successfully");
  return okVoid;
};

export const transactionSquashHandler: CommandHandlerWithDb<{
  count: number;
  yes?: boolean;
}> = async (context) => {
  const { kg, ui, log, config, fs, args } = context;
  const transactionLogPath = join(config.paths.data, TRANSACTION_LOG_FILE);
  const logResult = await readLastTransactions(
    fs,
    transactionLogPath,
    args.count,
  );
  if (isErr(logResult)) return logResult;

  const transactionsToSquash = logResult.data;

  ui.heading(`Squashing ${args.count} transaction(s)`);

  await ui.printTransactions(kg, transactionsToSquash, "oneline");

  const uniqueAuthors = Array.from(
    new Set(transactionsToSquash.map((tx) => tx.author)),
  );
  if (uniqueAuthors.length > 1) {
    const newestAuthor =
      transactionsToSquash[transactionsToSquash.length - 1]!.author;
    ui.warning(
      `Authors [${uniqueAuthors.join(", ")}] will be replaced with "${newestAuthor}"`,
    );
  }

  const confirmResult = await confirmProtected(
    ui,
    args,
    "Do you want to proceed with squashing? (yes/no): ",
  );
  if (isErr(confirmResult)) return confirmResult;
  if (!confirmResult.data) {
    ui.info("Squash cancelled");
    return okVoid;
  }

  const squashResult = await squashTransactions(context, args.count);
  if (isErr(squashResult)) {
    log.error("Failed to squash transactions", {
      error: squashResult.error,
    });
    return squashResult;
  }

  const squashedTransaction = squashResult.data;

  log.info("Squashed successfully", { count: args.count });
  ui.block(() => {
    ui.success("Squashed successfully");
    ui.info(
      `Transactions ${transactionsToSquash[0]!.id}-${transactionsToSquash[args.count - 1]!.id} merged into transaction #${squashedTransaction.id}`,
    );
  });
  return okVoid;
};

export const transactionLogHandler: CommandHandlerWithDb<
  {
    format: string;
    oneline?: boolean;
    author?: string;
    chronological?: boolean;
  } & SelectionArgs
> = async ({ kg, ui, args }) => {
  const count = args.last ?? args.limit ?? 10;
  const readCount = count + (args.skip ?? 0);

  const listResult = await kg.listTransactions({
    limit: readCount,
    order: args.chronological ? "asc" : "desc",
  });
  if (isErr(listResult)) return listResult;

  let transactions = listResult.data;
  if (args.author) {
    transactions = transactions.filter((tx) => tx.author === args.author);
  }

  transactions = applySelection(transactions, args);

  if (includes(serializeFormats, args.format)) {
    ui.printData(transactions, args.format);
    return okVoid;
  }

  const format = args.oneline
    ? "oneline"
    : args.format === "full"
      ? "full"
      : "concise";

  const resolved = await resolveTransactionDisplayKeys(kg, transactions);
  const dividerWidth =
    format !== "oneline"
      ? 61 + Math.max(...resolved.map((tx) => tx.author.length))
      : 0;
  await withPager(() => {
    for (const tx of resolved) {
      ui.printRawTransaction(tx, format);
      if (format !== "oneline") {
        ui.divider(dividerWidth);
      }
    }
  });
  return okVoid;
};

export const transactionExportHandler: CommandHandlerWithDb<{
  output?: string;
  last: number;
  from?: number;
  to?: number;
}> = async ({ kg, ui, fs, args }) => {
  const useRange = args.from !== undefined || args.to !== undefined;
  const listResult = await kg.listTransactions({
    order: useRange ? "asc" : "desc",
    limit: useRange ? 10000 : args.last,
  });
  if (isErr(listResult)) return listResult;

  const transactions = useRange
    ? listResult.data.filter((tx) => {
        if (args.from !== undefined && tx.id < args.from) return false;
        if (args.to !== undefined && tx.id > args.to) return false;
        return true;
      })
    : listResult.data.reverse();

  const inputs = transactions.map(transactionToInput);
  const format = args.output ? detectFileFormat(args.output) : "jsonl";
  const serialized = serialize(inputs, format, normalizeTransactionInput);

  if (args.output) {
    const writeResult = await fs.writeFile(args.output, serialized);
    if (isErr(writeResult)) return writeResult;
    ui.success(`Exported ${inputs.length} transaction(s) to ${args.output}`);
  } else {
    ui.println(serialized);
  }

  return okVoid;
};

export const TransactionCommand = types({
  command: "transaction <command>",
  aliases: ["tx"],
  describe: "manage transactions",
  builder: (yargs: Argv) => {
    return yargs
      .command(
        types({
          command: "import [files...]",
          aliases: ["create", "add"],
          describe: "import transactions from file(s) or stdin",
          builder: (yargs: Argv) => {
            return withTxMetadata(
              yargs
                .positional("files", {
                  describe: "path(s) to transaction file(s), or pipe via stdin",
                  type: "string",
                  array: true,
                })
                .options({
                  ...dryRunOption,
                  ...selectionOptions,
                }),
            );
          },
          handler: runtimeWithDb(transactionImportHandler),
        }),
      )
      .command(
        types({
          command: "export",
          describe: "export transactions as TransactionInput format",
          builder: (yargs: Argv) => {
            return yargs
              .option("output", {
                alias: "o",
                describe:
                  "output file (format from extension: .yaml, .json, .jsonl)",
                type: "string",
              })
              .option("last", {
                alias: "n",
                describe: "export last N transactions",
                type: "number",
                default: 1,
              })
              .option("from", {
                describe: "export starting from transaction ID",
                type: "number",
              })
              .option("to", {
                describe: "export up to transaction ID",
                type: "number",
              });
          },
          handler: runtimeWithDb(transactionExportHandler),
        }),
      )
      .command(
        types({
          command: "read <ref>",
          aliases: ["fetch", "get"],
          describe: "read a transaction by reference",
          builder: (yargs: Argv) => {
            return yargs
              .positional("ref", {
                describe: "transaction reference (id | hash)",
                type: "string",
                demandOption: true,
                coerce: (value: string) =>
                  normalizeEntityRef<"transaction">(value),
              })
              .options(itemFormatOption);
          },
          handler: runtimeWithDb(transactionReadHandler),
        }),
      )
      .command(
        types({
          command: "rollback [count]",
          describe: "rollback the last N transactions",
          builder: (yargs: Argv) => {
            return yargs
              .positional("count", {
                describe: "number of transactions to rollback",
                type: "number",
                default: 1,
              })
              .options(yesOption);
          },
          handler: runtimeWithDb(transactionRollbackHandler),
        }),
      )
      .command(
        types({
          command: "squash [count]",
          describe: "squash the last N transactions into one",
          builder: (yargs: Argv) => {
            return yargs
              .positional("count", {
                describe: "number of transactions to squash",
                type: "number",
                default: 2,
              })
              .options(yesOption);
          },
          handler: runtimeWithDb(transactionSquashHandler),
        }),
      )
      .command(
        types({
          command: "log",
          describe: "show recent transactions from the log",
          builder: (yargs: Argv) => {
            return yargs
              .options(selectionOptions)
              .option("format", {
                describe: "output format",
                type: "string",
                choices: ["concise", "full", "oneline", ...serializeFormats],
                default: "concise",
              })
              .option("oneline", {
                describe:
                  "show one transaction per line (shorthand for --format oneline)",
                type: "boolean",
                default: false,
              })
              .option("author", {
                describe: "filter transactions by author",
                type: "string",
              })
              .option("chronological", {
                describe:
                  "show transactions in chronological order (oldest first)",
                type: "boolean",
                default: false,
              });
          },
          handler: runtimeWithDb(transactionLogHandler),
        }),
      )
      .demandCommand(
        1,
        "You need to specify a subcommand: import, export, read, rollback, squash, log",
      );
  },
  handler: async () => {},
});
