import type { Argv } from "yargs";
import * as YAML from "yaml";
import { isErr, ok } from "@binder/utils";
import {
  type ConfigRef,
  type ConfigType,
  type NodeType,
  normalizeEntityRef,
} from "@binder/db";
import { type CommandHandlerWithDb, runtimeWithDb } from "../runtime.ts";
import { renderSchemaPreview } from "../schema/schema-preview.ts";
import { filterSchemaByTypes } from "../schema/schema-filter.ts";
import { printTransaction } from "../ui.ts";
import { parsePatches, patchesDescription } from "../lib/patch-parser.ts";
import { types } from "./types.ts";

export const configCreateHandler: CommandHandlerWithDb<{
  type: ConfigType;
  patches: string[];
}> = async ({ kg, config, args }) => {
  const fieldsResult = parsePatches(args.patches);
  if (isErr(fieldsResult)) return fieldsResult;

  const result = await kg.update({
    author: config.author,
    nodes: [],
    configurations: [
      {
        type: args.type,
        ...fieldsResult.data,
      },
    ],
  });
  if (isErr(result)) return result;

  printTransaction(result.data);
  return ok("Config entity created successfully");
};

export const configReadHandler: CommandHandlerWithDb<{
  ref: ConfigRef;
}> = async ({ kg, ui, args }) => {
  const result = await kg.fetchConfig(args.ref);
  if (isErr(result)) return result;

  ui.printData(result.data);
  return ok(undefined);
};

export const configUpdateHandler: CommandHandlerWithDb<{
  ref: ConfigRef;
  patches: string[];
}> = async ({ kg, config, args }) => {
  const fieldsResult = parsePatches(args.patches);
  if (isErr(fieldsResult)) return fieldsResult;

  const result = await kg.update({
    author: config.author,
    nodes: [],
    configurations: [
      {
        $ref: args.ref,
        ...fieldsResult.data,
      },
    ],
  });
  if (isErr(result)) return result;

  printTransaction(result.data);
  return ok("Config entity updated successfully");
};

export const configListHandler: CommandHandlerWithDb<{
  type?: ConfigType;
}> = async ({ log, args }) => {
  const filters = args.type ? { type: args.type } : {};

  // TODO: This will need a dedicated search implementation for config namespace
  // For now, return a placeholder message
  log.info("config list not yet implemented", { filters });
  return ok("Config list not yet implemented");
};

export const configSchemaHandler: CommandHandlerWithDb<{
  format: "json" | "yaml" | "pretty";
  namespace: "node" | "config";
  types?: NodeType[];
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

const ConfigCommand = types({
  command: "config <command>",
  describe: "manage configuration entities (Type, Field, Instruction, etc.)",
  builder: (yargs: Argv) => {
    return yargs
      .command(
        types({
          command: "create <type> [patches..]",
          aliases: ["add"],
          describe: "create a new config entity with field=value patches",
          builder: (yargs: Argv) => {
            return yargs
              .positional("type", {
                describe:
                  "config entity type (Type, Field, Instruction, Integration, etc.)",
                type: "string",
                demandOption: true,
                coerce: (value: string) => value as ConfigType,
              })
              .positional("patches", {
                describe: patchesDescription,
                type: "string",
                array: true,
                default: [],
              });
          },
          handler: runtimeWithDb(configCreateHandler),
        }),
      )
      .command(
        types({
          command: "read <ref>",
          aliases: ["fetch", "get"],
          describe: "read a config entity by reference",
          builder: (yargs: Argv) => {
            return yargs.positional("ref", {
              describe: "config entity reference (id | uid | key)",
              type: "string",
              demandOption: true,
              coerce: (value: string) => normalizeEntityRef<"config">(value),
            });
          },
          handler: runtimeWithDb(configReadHandler),
        }),
      )
      .command(
        types({
          command: "update <ref> [patches..]",
          describe: "update a config entity with field=value patches",
          builder: (yargs: Argv) => {
            return yargs
              .positional("ref", {
                describe: "config entity reference (id | uid | key)",
                type: "string",
                demandOption: true,
                coerce: (value: string) => normalizeEntityRef<"config">(value),
              })
              .positional("patches", {
                describe: patchesDescription,
                type: "string",
                array: true,
                default: [],
              });
          },
          handler: runtimeWithDb(configUpdateHandler),
        }),
      )
      .command(
        types({
          command: "delete <ref>",
          aliases: ["remove"],
          describe: "delete a config entity by reference",
          builder: (yargs: Argv) => {
            return yargs.positional("ref", {
              describe: "config entity reference (id | uid | key)",
              type: "string",
              demandOption: true,
              coerce: (value: string) => normalizeEntityRef<"config">(value),
            });
          },
          handler: async () => {},
        }),
      )
      .command(
        types({
          command: "list",
          aliases: ["ls"],
          describe: "list config entities with optional type filter",
          builder: (yargs: Argv) => {
            return yargs.option("type", {
              describe: "filter by config entity type",
              type: "string",
              coerce: (value: string) => value as ConfigType,
            });
          },
          handler: runtimeWithDb(configListHandler),
        }),
      )
      .command(
        types({
          command: "schema",
          describe:
            "view schema (Type and Field entities in structured format)",
          builder: (yargs: Argv) => {
            return yargs
              .option("types", {
                describe: "comma-separated list of type names to include",
                type: "array",
                coerce: (value: string[]) => value as NodeType[],
              })
              .option("format", {
                describe: "output format",
                type: "string",
                choices: ["json", "yaml", "pretty"] as const,
                default: "pretty" as const,
              })
              .option("namespace", {
                describe:
                  "which namespace schema to view (node=user entities, config=system schema)",
                type: "string",
                choices: ["node", "config"] as const,
                default: "node" as const,
                alias: "n",
              });
          },
          handler: runtimeWithDb(configSchemaHandler),
        }),
      )
      .demandCommand(
        1,
        "You need to specify a subcommand: create, read, update, delete, list, schema",
      );
  },
  handler: async () => {},
});

export default ConfigCommand;
