import type { Argv } from "yargs";
import { isErr, ok } from "@binder/utils";
import {
  type FieldChangeInput,
  type FieldChangesetInput,
  type FieldKey,
  type NodeRef,
  type NodeType,
  normalizeEntityRef,
} from "@binder/db";
import { Log } from "../log.ts";
import { bootstrapWithDb, type CommandHandlerWithDb } from "../bootstrap.ts";
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

export const nodeCreateHandler: CommandHandlerWithDb<{
  type: NodeType;
  patches: string[];
}> = async ({ kg, config, ui, args }) => {
  const fields = parsePatches(args.patches);
  const result = await kg.update({
    author: config.author,
    nodes: [
      {
        type: args.type,
        ...fields,
      },
    ],
    configurations: [],
  });
  if (isErr(result)) return result;

  ui.printData(result.data);
  return ok("Node created successfully");
};

export const nodeReadHandler: CommandHandlerWithDb<{
  ref: NodeRef;
}> = async ({ kg, ui, args }) => {
  const result = await kg.fetchNode(args.ref);
  if (isErr(result)) return result;

  ui.printData(result.data);
  return ok(undefined);
};

export const nodeUpdateHandler: CommandHandlerWithDb<{
  ref: NodeRef;
  patches: string[];
}> = async ({ kg, config, ui, args }) => {
  const fields = parsePatches(args.patches);

  const result = await kg.update({
    author: config.author,
    nodes: [
      {
        $ref: args.ref,
        ...fields,
      },
    ],
    configurations: [],
  });
  if (isErr(result)) return result;

  ui.printData(result.data);
  return ok("Node updated successfully");
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
          handler: bootstrapWithDb(nodeCreateHandler),
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
          handler: bootstrapWithDb(nodeReadHandler),
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
          handler: bootstrapWithDb(nodeUpdateHandler),
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
