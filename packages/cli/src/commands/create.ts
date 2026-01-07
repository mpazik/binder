import type { Argv } from "yargs";
import { isErr, ok } from "@binder/utils";
import { type EntityNsType, type NamespaceEditable } from "@binder/db";
import { runtimeWithDb, type CommandHandlerWithDb } from "../runtime.ts";
import {
  createPatchExamples,
  parsePatches,
  patchesDescription,
} from "../lib/patch-parser.ts";
import { types } from "./types.ts";
import { namespaceOption } from "./options.ts";

const createHandler: CommandHandlerWithDb<{
  type: string;
  patches: string[];
  namespace: NamespaceEditable;
}> = async ({ kg, config, ui, args }) => {
  const schemaResult = await kg.getSchema(args.namespace);
  if (isErr(schemaResult)) return schemaResult;

  const fieldsResult = parsePatches(args.patches, schemaResult.data);
  if (isErr(fieldsResult)) return fieldsResult;

  const entityInput = {
    type: args.type as EntityNsType[typeof args.namespace],
    ...fieldsResult.data,
  };

  const result = await kg.update({
    author: config.author,
    nodes: args.namespace === "node" ? [entityInput] : [],
    configurations: args.namespace === "config" ? [entityInput] : [],
  });
  if (isErr(result)) return result;

  ui.printData(result.data);
  return ok("Created successfully");
};

const CreateCommand = types({
  command: "create <type> [patches..]",
  aliases: ["add"],
  describe: "create with field=value patches",
  builder: (yargs: Argv) =>
    yargs
      .positional("type", {
        describe: "type",
        type: "string",
        demandOption: true,
      })
      .positional("patches", {
        describe: patchesDescription,
        type: "string",
        array: true,
        default: [],
      })
      .options(namespaceOption)
      .example(createPatchExamples("create Task")),
  handler: runtimeWithDb(createHandler),
});

export default CreateCommand;
