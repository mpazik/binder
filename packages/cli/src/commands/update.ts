import type { Argv } from "yargs";
import { isErr, ok } from "@binder/utils";
import {
  type EntityRef,
  type NamespaceEditable,
  normalizeEntityRef,
} from "@binder/db";
import { runtimeWithDb, type CommandHandlerWithDb } from "../runtime.ts";
import {
  createPatchExamples,
  parsePatches,
  patchesDescription,
} from "../lib/patch-parser.ts";
import { types } from "./types.ts";
import { namespaceOption } from "./options.ts";

const updateHandler: CommandHandlerWithDb<{
  ref: EntityRef;
  patches: string[];
  namespace: NamespaceEditable;
}> = async ({ kg, config, ui, args }) => {
  const schemaResult = await kg.getSchema(args.namespace);
  if (isErr(schemaResult)) return schemaResult;

  const fieldsResult = parsePatches(args.patches, schemaResult.data);
  if (isErr(fieldsResult)) return fieldsResult;

  const entityInput = {
    $ref: args.ref,
    ...fieldsResult.data,
  };

  const result = await kg.update({
    author: config.author,
    nodes: args.namespace === "node" ? [entityInput] : [],
    configurations: args.namespace === "config" ? [entityInput] : [],
  });
  if (isErr(result)) return result;

  ui.printData(result.data);
  return ok("Updated successfully");
};

const UpdateCommand = types({
  command: "update <ref> [patches..]",
  describe: "update with field=value patches",
  builder: (yargs: Argv) =>
    yargs
      .positional("ref", {
        describe: "reference (id | uid | key)",
        type: "string",
        demandOption: true,
        coerce: (value: string) => normalizeEntityRef(value),
      })
      .positional("patches", {
        describe: patchesDescription,
        type: "string",
        array: true,
        default: [],
      })
      .options(namespaceOption)
      .example(createPatchExamples("update <ref>")),
  handler: runtimeWithDb(updateHandler),
});

export default UpdateCommand;
