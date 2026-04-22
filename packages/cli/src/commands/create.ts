import type { Argv } from "yargs";
import { fail, isErr, ok } from "@binder/utils";
import {
  createTransactionInput,
  type EntityCreate,
  EntityCreateInputSchema,
  type EntityNsType,
  type NamespaceEditable,
} from "@binder/repo";
import { type CommandHandlerWithDb, runtimeWithDb } from "../runtime.ts";
import {
  createPatchExamples,
  parseCreatePatches,
  parsePatches,
} from "../lib/patch-parser.ts";
import { types } from "../cli/types.ts";
import { itemFormatOption, namespaceOption } from "../cli/options.ts";
import type { SerializeItemFormat } from "../utils/serialize.ts";
import { isStdinPiped, readStdinAsArray } from "../cli/stdin.ts";

const createHandler: CommandHandlerWithDb<{
  patches: string[];
  namespace: NamespaceEditable;
  format?: SerializeItemFormat;
}> = async ({ kg, config, ui, args }) => {
  let inputs: EntityCreate<typeof args.namespace>[];

  if (isStdinPiped()) {
    if (args.patches.length > 0)
      return fail(
        "conflicting-input",
        "Cannot combine stdin with positional arguments",
      );

    const inputsResult = await readStdinAsArray(EntityCreateInputSchema);
    if (isErr(inputsResult)) return inputsResult;

    inputs = inputsResult.data as EntityCreate<typeof args.namespace>[];
  } else {
    const parsedResult = parseCreatePatches(args.patches);
    if (isErr(parsedResult)) return parsedResult;
    const { type, fieldPatches } = parsedResult.data;

    const schemaResult = await kg.getSchema(args.namespace);
    if (isErr(schemaResult)) return schemaResult;

    if (!schemaResult.data.types[type])
      return fail(
        "type-not-found",
        `Unknown type '${type}'. Run binder schema to see available types.`,
      );

    const fieldsResult = parsePatches(fieldPatches, schemaResult.data);
    if (isErr(fieldsResult)) return fieldsResult;

    inputs = [
      {
        type: type as EntityNsType[typeof args.namespace],
        ...fieldsResult.data,
      },
    ];
  }

  const result = await kg.update(
    createTransactionInput(config.author, args.namespace, inputs),
  );
  if (isErr(result)) return result;

  ui.printData(result.data, args.format);
  return ok(undefined);
};

export const CreateCommand = types({
  command: "create [patches..]",
  aliases: ["add"],
  describe: "create with field=value patches or stdin",
  builder: (yargs: Argv) =>
    yargs
      .positional("patches", {
        describe:
          "type, optional key, then field patches — or all as field=value patches",
        type: "string",
        array: true,
        default: [],
      })
      .options({ ...namespaceOption, ...itemFormatOption })
      .example([
        ["$0 create Task title=Hello", "Create entity"],
        ["$0 create Task my-key title=Hello", "Create with key"],
        ...createPatchExamples("create Task"),
      ]),
  handler: runtimeWithDb(createHandler),
});
