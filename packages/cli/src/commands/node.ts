import type { Argv } from "yargs";
import { isErr, ok } from "@binder/utils";
import { type NodeRef, type NodeType, normalizeEntityRef } from "@binder/db";
import { Log } from "../log.ts";
import {
  bootstrapWithDbRead,
  bootstrapWithDbWrite,
  type CommandHandlerWithDbRead,
  type CommandHandlerWithDbWrite,
} from "../bootstrap.ts";
import { parsePatches, patchesDescription } from "../lib/patch-parser.ts";
import { types } from "./types.ts";

export const nodeCreateHandler: CommandHandlerWithDbWrite<{
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

export const nodeReadHandler: CommandHandlerWithDbRead<{
  ref: NodeRef;
}> = async ({ kg, ui, args }) => {
  const result = await kg.fetchNode(args.ref);
  if (isErr(result)) return result;

  ui.printData(result.data);
  return ok(undefined);
};

export const nodeUpdateHandler: CommandHandlerWithDbWrite<{
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
                describe: patchesDescription,
                type: "string",
                array: true,
                default: [],
              });
          },
          handler: bootstrapWithDbWrite(nodeCreateHandler),
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
          handler: bootstrapWithDbRead(nodeReadHandler),
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
                describe: patchesDescription,
                type: "string",
                array: true,
                default: [],
              });
          },
          handler: bootstrapWithDbWrite(nodeUpdateHandler),
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
