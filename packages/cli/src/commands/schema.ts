import type { Argv } from "yargs";
import { fail, findSimilar, isErr, okVoid } from "@binder/utils";
import {
  type EntityKey,
  type EntityType,
  type NamespaceEditable,
} from "@binder/db";
import { type CommandHandlerWithDb, runtimeWithDb } from "../runtime.ts";
import { renderSchemaPreview } from "../schema/schema-preview.ts";
import { filterSchema } from "../schema/schema-filter.ts";
import { types } from "../cli/types.ts";
import { namespaceOption, parseCommaSeparatedList } from "../cli/options.ts";
import {
  serializeItemFormats,
  type SerializeItemFormat,
} from "../utils/serialize.ts";

const validateKeys = (
  keys: string[],
  knownKeys: Record<string, unknown>,
  errorKey: string,
  kind: "type" | "field",
) => {
  const unknown = keys.find((key) => !knownKeys[key]);
  if (!unknown) return undefined;

  const similar = findSimilar(Object.keys(knownKeys), unknown, { max: 3 });
  const suggestion =
    similar.length > 0
      ? `Did you mean ${similar.map((m) => `'${m.value}'`).join(", ")}?`
      : `Run 'binder schema' to list available ${kind} keys.`;

  return fail(errorKey, `Unknown ${kind} key: ${unknown}`, { suggestion });
};

export const schemaHandler: CommandHandlerWithDb<{
  namespace: NamespaceEditable;
  typeKeys?: EntityType[];
  types?: EntityType[];
  fields?: EntityKey[];
  format?: SerializeItemFormat;
}> = async ({ kg, ui, args }) => {
  const schemaResult = await kg.getSchema(args.namespace);
  if (isErr(schemaResult)) return schemaResult;
  const schema = schemaResult.data;

  const typeKeys = [
    ...new Set([...(args.typeKeys ?? []), ...(args.types ?? [])]),
  ];
  const fieldKeys = [...new Set(args.fields ?? [])];

  if (typeKeys.length > 0) {
    const error = validateKeys(
      typeKeys,
      schema.types,
      "unknown-type-key",
      "type",
    );
    if (error) return error;
  }

  if (fieldKeys.length > 0) {
    const error = validateKeys(
      fieldKeys,
      schema.fields,
      "unknown-field-key",
      "field",
    );
    if (error) return error;
  }

  const filteredSchema =
    typeKeys.length > 0 || fieldKeys.length > 0
      ? filterSchema(schema, {
          typeKeys: typeKeys.length > 0 ? typeKeys : undefined,
          fieldKeys: fieldKeys.length > 0 ? fieldKeys : undefined,
        })
      : schema;

  if (args.format) {
    ui.printData(filteredSchema, args.format);
  } else {
    ui.println(renderSchemaPreview(filteredSchema));
  }

  return okVoid;
};

export const SchemaCommand = types({
  command: "schema [typeKeys..]",
  describe: "view schema (types and fields in structured format)",
  builder: (yargs: Argv) =>
    yargs
      .positional("typeKeys", {
        describe: "type keys to include",
        type: "string",
        array: true,
        default: [],
        coerce: (value: string[] | string) =>
          parseCommaSeparatedList<EntityType>(value),
      })
      .option("types", {
        describe: "comma-separated list of type names to include",
        type: "array",
        coerce: (value: string[] | string) =>
          parseCommaSeparatedList<EntityType>(value),
      })
      .option("fields", {
        alias: "f",
        describe: "comma-separated list of field keys to include",
        type: "array",
        coerce: (value: string[] | string) =>
          parseCommaSeparatedList<EntityKey>(value),
      })
      .options({
        ...namespaceOption,
        format: {
          describe: "output format",
          type: "string" as const,
          choices: serializeItemFormats,
        },
      }),
  handler: runtimeWithDb(schemaHandler),
});
