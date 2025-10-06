import type { Argv } from "yargs";
import { isErr } from "@binder/utils";
import {
  type FieldChangeInput,
  type FieldChangesetInput,
  type FieldKey,
  type NodeType,
  normalizeEntityRef,
  openDb,
  openKnowledgeGraph,
} from "@binder/db";
import { Log } from "../log.ts";
import { AUTHOR, DB_PATH } from "../config.ts";
import { printData } from "../ui.ts";
import { types } from "./types.ts";

const parseFieldChange = (fieldChange: string): FieldChangeInput => {
  const equalIndex = fieldChange.indexOf("=");
  if (equalIndex === -1) {
    Log.error("Invalid patch format (expected field=value)", {
      patch: fieldChange,
    });
    process.exit(1);
  }
  const value = fieldChange.slice(equalIndex + 1);

  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+$/.test(value)) return parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);
  return value;
};

const parsePatches = (patches: string[]): FieldChangesetInput => {
  const result: Record<string, FieldChangeInput> = {};
  for (const patch of patches) {
    const equalIndex = patch.indexOf("=");
    if (equalIndex === -1) {
      Log.error("Invalid patch format (expected field=value)", { patch });
      process.exit(1);
    }
    const fieldKey = patch.slice(0, equalIndex) as FieldKey;
    result[fieldKey] = parseFieldChange(patch);
  }
  return result;
};

const NodeCommand = types({
  command: "node <command>",
  describe: "create, read, update, or delete nodes",
  builder: (yargs: Argv) => {
    return yargs
      .command(
        types({
          command: "create <type> [patches..]",
          aliases: ["add"],
          describe: "create a new node with field=value patches",
          builder: (yargs: Argv) => {
            return yargs
              .positional("type", {
                describe: "node type",
                type: "string",
                demandOption: true,
                coerce: (value: string) => value as NodeType,
              })
              .positional("patches", {
                describe: "field=value patches",
                type: "string",
                array: true,
                default: [],
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

            const fields = parsePatches(args.patches);

            const result = await kg.update({
              author: AUTHOR,
              nodes: [
                {
                  type: args.type,
                  ...fields,
                },
              ],
              configurations: [],
            });
            if (isErr(result)) {
              Log.error("Failed to create node", { error: result.error });
              process.exit(1);
            }

            Log.info("Node created successfully");
            printData(result.data);
          },
        }),
      )
      .command(
        types({
          command: "read <ref>",
          aliases: ["fetch", "get"],
          describe: "read a node by reference",
          builder: (yargs: Argv) => {
            return yargs.positional("ref", {
              describe: "node reference (id | uid | key)",
              type: "string",
              demandOption: true,
              coerce: (value: string) => normalizeEntityRef<"node">(value),
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

            const result = await kg.fetchNode(args.ref);
            if (isErr(result)) {
              Log.error("Failed to read node", { error: result.error });
              process.exit(1);
            }

            printData(result.data);
          },
        }),
      )
      .command(
        types({
          command: "update <ref> [patches..]",
          describe: "update a node with field=value patches",
          builder: (yargs: Argv) => {
            return yargs
              .positional("ref", {
                describe: "node reference (id | uid | key)",
                type: "string",
                demandOption: true,
                coerce: (value: string) => normalizeEntityRef<"node">(value),
              })
              .positional("patches", {
                describe: "field=value patches",
                type: "string",
                array: true,
                default: [],
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

            const fields = parsePatches(args.patches);

            const result = await kg.update({
              author: AUTHOR,
              nodes: [
                {
                  $ref: args.ref,
                  ...fields,
                },
              ],
              configurations: [],
            });
            if (isErr(result)) {
              Log.error("Failed to update node", { error: result.error });
              process.exit(1);
            }

            Log.info("Node updated successfully");
            printData(result.data);
          },
        }),
      )
      .command(
        types({
          command: "delete <ref>",
          aliases: ["remove"],
          describe: "delete a node by reference",
          builder: (yargs: Argv) => {
            return yargs.positional("ref", {
              describe: "node reference (id | uid | key)",
              type: "string",
              demandOption: true,
              coerce: (value: string) => normalizeEntityRef<"node">(value),
            });
          },
          handler: async (args) => {
            Log.info(`node delete: ref=${args.ref}`);
          },
        }),
      )
      .demandCommand(
        1,
        "You need to specify a subcommand: create, read, update",
      );
  },
  handler: async () => {},
});
export default NodeCommand;
