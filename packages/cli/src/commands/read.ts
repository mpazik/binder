import type { Argv } from "yargs";
import { z } from "zod";
import { fail, isErr, ok } from "@binder/utils";
import {
  type EntityRef,
  type Fieldset,
  type Includes,
  IncludesSchema,
  type NamespaceEditable,
  type ReadonlyKnowledgeGraph,
  normalizeEntityRef,
} from "@binder/repo";
import {
  type CommandHandlerReadonly,
  runtimeWithReadonlyRepo,
} from "../runtime.ts";
import { types } from "../cli/types.ts";
import {
  fieldsOption,
  itemFormatOption,
  namespaceOption,
} from "../cli/options.ts";
import type { SerializeItemFormat } from "../utils/serialize.ts";
import { isStdinPiped, readStdinAs } from "../cli/stdin.ts";
import { formatReferences } from "../document/reference.ts";

const ReadStdinSchema = z.object({
  includes: IncludesSchema.optional(),
});

const formatEntity = async (
  kg: ReadonlyKnowledgeGraph,
  entity: Fieldset,
  namespace: NamespaceEditable,
) => {
  const schemaResult = await kg.getSchema(namespace);
  if (isErr(schemaResult)) return schemaResult;
  return formatReferences(entity, schemaResult.data, kg);
};

const readHandler: CommandHandlerReadonly<{
  ref: EntityRef;
  namespace: NamespaceEditable;
  format?: SerializeItemFormat;
  fields?: Includes;
}> = async ({ kg, ui, args }) => {
  let includes: Includes | undefined = args.fields;

  if (isStdinPiped()) {
    if (args.fields !== undefined)
      return fail(
        "conflicting-input",
        "Cannot combine stdin with --fields option",
      );

    const stdinResult = await readStdinAs(ReadStdinSchema);
    if (isErr(stdinResult)) return stdinResult;
    includes = stdinResult.data.includes;
  }

  const result = await kg.fetchEntity(args.ref, includes, args.namespace);
  if (isErr(result)) return result;

  const formatted = await formatEntity(kg, result.data, args.namespace);
  if (isErr(formatted)) return formatted;

  ui.printData(formatted.data, args.format);
  return ok(undefined);
};

export const ReadCommand = types({
  command: "read <ref>",
  aliases: ["fetch", "get"],
  describe: "fetch by reference",
  builder: (yargs: Argv) =>
    yargs
      .positional("ref", {
        describe: "reference (id | uid | key)",
        type: "string",
        demandOption: true,
        coerce: (value: string) => normalizeEntityRef(value),
      })
      .options({ ...namespaceOption, ...itemFormatOption, ...fieldsOption }),
  handler: runtimeWithReadonlyRepo(readHandler),
});
