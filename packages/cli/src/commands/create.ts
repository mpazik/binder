import type { Argv } from "yargs";
import { fail, isErr, ok } from "@binder/utils";
import {
  createTransactionInput,
  type EntityCreate,
  EntityCreateInputSchema,
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
import { isStdinPiped, parseStdinAs } from "../cli/stdin.ts";

const createHandler: CommandHandlerWithDb<{
  type?: string;
  patches: string[];
  namespace: NamespaceEditable;
  format?: SerializeItemFormat;
}> = async ({ kg, config, ui, args }) => {
  const hasPositionalArgs = args.type !== undefined || args.patches.length > 0;

  if (isStdinPiped()) {
    if (hasPositionalArgs)
      return fail(
        "conflicting-input",
        "Cannot combine stdin with positional arguments",
      );

    const inputsResult = await parseStdinAs(EntityCreateInputSchema);
    if (isErr(inputsResult)) return inputsResult;

    const inputs = inputsResult.data as EntityCreate<typeof args.namespace>[];
    const result = await kg.update(
      createTransactionInput(config.author, args.namespace, inputs),
    );
    if (isErr(result)) return result;

    ui.printData(result.data, args.format);
    return ok(undefined);
  }

  if (!args.type)
    return fail(
      "missing-type",
      "Provide a type (e.g., binder create Task) or pipe data via stdin",
    );

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
  command: "create [type] [patches..]",
  aliases: ["add"],
  describe: "create with field=value patches or stdin",
  builder: (yargs: Argv) =>
    yargs
      .positional("type", {
        describe: "type (required unless using stdin)",
        type: "string",
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
