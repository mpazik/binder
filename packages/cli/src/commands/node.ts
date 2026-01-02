import type { Argv } from "yargs";
import { isErr, ok } from "@binder/utils";
import { type NodeRef, type NodeType, normalizeEntityRef } from "@binder/db";
import { runtimeWithDb, type CommandHandlerWithDb } from "../runtime.ts";
import {
  createPatchExamples,
  parsePatches,
  patchesDescription,
} from "../lib/patch-parser.ts";
import { types } from "./types.ts";

export const nodeCreateHandler: CommandHandlerWithDb<{
  type: NodeType;
  patches: string[];
}> = async ({ kg, config, ui, args }) => {
  const schemaResult = await kg.getSchema("node");
  if (isErr(schemaResult)) return schemaResult;

  const fieldsResult = parsePatches(args.patches, schemaResult.data);
  if (isErr(fieldsResult)) return fieldsResult;

  const result = await kg.update({
    author: config.author,
    nodes: [
      {
        type: args.type,
        ...fieldsResult.data,
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
  const schemaResult = await kg.getSchema("node");
  if (isErr(schemaResult)) return schemaResult;

  const fieldsResult = parsePatches(args.patches, schemaResult.data);
  if (isErr(fieldsResult)) return fieldsResult;

  const result = await kg.update({
    author: config.author,
    nodes: [
      {
        $ref: args.ref,
        ...fieldsResult.data,
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
          builder: (yargs: Argv) =>
            yargs
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
              })
              .example(createPatchExamples("node create Task")),
          handler: runtimeWithDb(nodeCreateHandler),
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
          handler: runtimeWithDb(nodeReadHandler),
        }),
      )
      .command(
        types({
          command: "update <ref> [patches..]",
          describe: "update a node with field=value patches",
          builder: (yargs: Argv) =>
            yargs
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
              })
              .example(createPatchExamples("node update <ref>")),
          handler: runtimeWithDb(nodeUpdateHandler),
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
          handler: async () => {},
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
