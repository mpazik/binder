import type { Argv } from "yargs";
import * as YAML from "yaml";
import { errorToObject, isErr, tryCatch } from "@binder/utils";
import {
  TransactionInput as TransactionInputSchema,
  openDb,
  openKnowledgeGraph,
  normalizeEntityRef,
} from "@binder/db";
import { Log } from "../log.ts";
import { AUTHOR, DB_PATH } from "../config.ts";
import { printData } from "../ui.ts";
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
          handler: async (args) => {
            const path = args.path;

            if (!path) {
              Log.error("Path to transaction file is required");
              process.exit(1);
            }

            const fileResult = await tryCatch(async () => {
              const bunFile = Bun.file(path);
              const text = await bunFile.text();
              return YAML.parse(text);
            }, errorToObject);

            if (isErr(fileResult)) {
              Log.error("Failed to read transaction file", {
                path,
                error: fileResult.error,
              });
              process.exit(1);
            }

            const rawData = fileResult.data as RawTransactionData;
            const transactionInput = {
              author: rawData.author || AUTHOR,
              nodes: transformToArray(rawData.nodes),
              configurations: transformToArray(rawData.configurations),
            };

            const validationResult = tryCatch(
              () => TransactionInputSchema.parse(transactionInput),
              errorToObject,
            );

            if (isErr(validationResult)) {
              Log.error("Invalid transaction format", {
                error: validationResult.error,
              });
              process.exit(1);
            }

            const dbResult = openDb({ path: DB_PATH, migrate: true });
            if (isErr(dbResult)) {
              Log.error("Failed to open database", {
                error: dbResult.error,
              });
              process.exit(1);
            }

            const db = dbResult.data;
            const kg = openKnowledgeGraph(db);

            const result = await kg.update(validationResult.data);
            if (isErr(result)) {
              Log.error("Failed to create transaction", {
                error: result.error,
              });
              process.exit(1);
            }

            Log.info("Transaction created successfully", { path });
            printData(result.data);
          },
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
          handler: async (args) => {
            const dbResult = openDb({ path: DB_PATH, migrate: true });
            if (isErr(dbResult)) {
              Log.error("Failed to open database", {
                error: dbResult.error,
              });
              process.exit(1);
            }

            const db = dbResult.data;
            const kg = openKnowledgeGraph(db);

            const result = await kg.fetchTransaction(args.ref);
            if (isErr(result)) {
              Log.error("Failed to read transaction", { error: result.error });
              process.exit(1);
            }

            printData(result.data);
          },
        }),
      )
      .demandCommand(1, "You need to specify a subcommand: create, read");
  },
  handler: async () => {},
});
export default TransactionCommand;
