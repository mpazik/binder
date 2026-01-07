import type { Argv } from "yargs";
import { isErr, ok } from "@binder/utils";
import {
  createTransactionInput,
  type EntityNsType,
  type NamespaceEditable,
} from "@binder/db";
import { type CommandHandlerWithDb, runtimeWithDb } from "../runtime.ts";
import {
  createPatchExamples,
  parsePatches,
  patchesDescription,
} from "../lib/patch-parser.ts";
import { types } from "../cli/types.ts";
import { itemFormatOption, namespaceOption } from "../cli/options.ts";
import type { SerializeItemFormat } from "../utils/serialize.ts";

const createHandler: CommandHandlerWithDb<{
  type: string;
  patches: string[];
  namespace: NamespaceEditable;
  format?: SerializeItemFormat;
}> = async ({ kg, config, ui, args }) => {
  const schemaResult = await kg.getSchema(args.namespace);
  if (isErr(schemaResult)) return schemaResult;

  const fieldsResult = parsePatches(args.patches, schemaResult.data);
  if (isErr(fieldsResult)) return fieldsResult;

  const entityInput = {
    type: args.type as EntityNsType[typeof args.namespace],
    ...fieldsResult.data,
  };

  const result = await kg.update(
    createTransactionInput(config.author, args.namespace, [entityInput]),
  );
  if (isErr(result)) return result;

  ui.printData(result.data, args.format);
  return ok(undefined);
};

export const CreateCommand = types({
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
      .options({ ...namespaceOption, ...itemFormatOption })
      .example(createPatchExamples("create Task")),
  handler: runtimeWithDb(createHandler),
});
