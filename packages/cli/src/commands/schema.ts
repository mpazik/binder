import type { Argv } from "yargs";
import * as YAML from "yaml";
import { isErr, ok } from "@binder/utils";
import { type EntityType, type NamespaceEditable } from "@binder/db";
import { type CommandHandlerWithDb, runtimeWithDb } from "../runtime.ts";
import { renderSchemaPreview } from "../schema/schema-preview.ts";
import { filterSchemaByTypes } from "../schema/schema-filter.ts";
import { types } from "../cli/types.ts";
import { itemFormatOption, namespaceOption } from "../cli/options.ts";
import type { SerializeItemFormat } from "../utils/serialize.ts";

const schemaHandler: CommandHandlerWithDb<{
  namespace: NamespaceEditable;
  types?: EntityType[];
  format?: SerializeItemFormat;
}> = async ({ kg, ui, args }) => {
  const schemaResult = await kg.getSchema(args.namespace);
  if (isErr(schemaResult)) return schemaResult;
  const schema = schemaResult.data;

  const filteredSchema = args.types
    ? filterSchemaByTypes(schema, args.types)
    : schema;

  if (args.format === "json") {
    ui.println(JSON.stringify(filteredSchema, null, 2));
  } else if (args.format === "yaml") {
    ui.println(
      YAML.stringify(filteredSchema, {
        indent: 2,
        lineWidth: 0,
        defaultStringType: "PLAIN",
      }),
    );
  } else {
    ui.println(renderSchemaPreview(filteredSchema));
  }

  return ok(undefined);
};

export const SchemaCommand = types({
  command: "schema",
  describe: "view schema (types and fields in structured format)",
  builder: (yargs: Argv) =>
    yargs
      .option("types", {
        describe: "comma-separated list of type names to include",
        type: "array",
        coerce: (value: string[]) => value as EntityType[],
      })
      .options({ ...namespaceOption, ...itemFormatOption }),
  handler: runtimeWithDb(schemaHandler),
});
