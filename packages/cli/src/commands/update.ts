import type { Argv } from "yargs";
import { fail, isErr, ok } from "@binder/utils";
import {
  createTransactionInput,
  type EntityRef,
  type EntityUpdate,
  EntityUpdateInputSchema,
  type NamespaceEditable,
  normalizeEntityRef,
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

const updateHandler: CommandHandlerWithDb<{
  ref?: EntityRef;
  patches: string[];
  namespace: NamespaceEditable;
  format?: SerializeItemFormat;
}> = async ({ kg, config, ui, args }) => {
  const hasPositionalArgs = args.ref !== undefined || args.patches.length > 0;

  if (isStdinPiped()) {
    if (hasPositionalArgs)
      return fail(
        "conflicting-input",
        "Cannot combine stdin with positional arguments",
      );

    const inputsResult = await parseStdinAs(EntityUpdateInputSchema);
    if (isErr(inputsResult)) return inputsResult;

    const inputs = inputsResult.data as EntityUpdate<typeof args.namespace>[];
    const result = await kg.update(
      createTransactionInput(config.author, args.namespace, inputs),
    );
    if (isErr(result)) return result;

    ui.printData(result.data, args.format);
    return ok(undefined);
  }

  if (!args.ref)
    return fail(
      "missing-ref",
      "Provide a reference (e.g., binder update <ref>) or pipe data via stdin",
    );

  const schemaResult = await kg.getSchema(args.namespace);
  if (isErr(schemaResult)) return schemaResult;

  const fieldsResult = parsePatches(args.patches, schemaResult.data);
  if (isErr(fieldsResult)) return fieldsResult;

  const entityInput = {
    $ref: args.ref,
    ...fieldsResult.data,
  };

  const result = await kg.update(
    createTransactionInput(config.author, args.namespace, [entityInput]),
  );
  if (isErr(result)) return result;

  ui.printData(result.data, args.format);
  return ok(undefined);
};

export const UpdateCommand = types({
  command: "update [ref] [patches..]",
  aliases: ["edit"],
  describe: "update with field=value patches or stdin",
  builder: (yargs: Argv) =>
    yargs
      .positional("ref", {
        describe: "reference (id | uid | key) - required unless using stdin",
        type: "string",
        coerce: (value: string | undefined) =>
          value ? normalizeEntityRef(value) : undefined,
      })
      .positional("patches", {
        describe: patchesDescription,
        type: "string",
        array: true,
        default: [],
      })
      .options({ ...namespaceOption, ...itemFormatOption })
      .example(createPatchExamples("update <ref>")),
  handler: runtimeWithDb(updateHandler),
});
