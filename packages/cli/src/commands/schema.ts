import type { Argv } from "yargs";
import * as YAML from "yaml";
import { isErr, ok } from "@binder/utils";
import { type EntityType, type NamespaceEditable } from "@binder/db";
import { runtimeWithDb, type CommandHandlerWithDb } from "../runtime.ts";
import { renderSchemaPreview } from "../schema/schema-preview.ts";
import { filterSchemaByTypes } from "../schema/schema-filter.ts";
import { types } from "./types.ts";
import { formatOption, namespaceOption, type OutputFormat } from "./options.ts";

const schemaHandler: CommandHandlerWithDb<{
  format: OutputFormat;
  namespace: NamespaceEditable;
  types?: EntityType[];
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

const SchemaCommand = types({
  command: "schema",
  describe: "view schema (types and fields in structured format)",
  builder: (yargs: Argv) =>
    yargs
      .option("types", {
        describe: "comma-separated list of type names to include",
        type: "array",
        coerce: (value: string[]) => value as EntityType[],
      })
      .options({ ...namespaceOption, ...formatOption }),
  handler: runtimeWithDb(schemaHandler),
});

export default SchemaCommand;
