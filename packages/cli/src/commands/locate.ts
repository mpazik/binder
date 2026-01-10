import type { Argv } from "yargs";
import { fail, isErr, ok } from "@binder/utils";
import {
  type EntityRef,
  type NamespaceEditable,
  normalizeEntityRef,
} from "@binder/db";
import { runtimeWithDb, type CommandHandlerWithDb } from "../runtime.ts";
import { findEntityLocation, loadNavigation } from "../document/navigation.ts";
import { types } from "../cli/types.ts";
import { namespaceOption } from "../cli/options.ts";

const locateHandler: CommandHandlerWithDb<{
  ref: EntityRef;
  namespace: NamespaceEditable;
}> = async ({ kg, fs, config, ui, args }) => {
  const fetchResult = await kg.fetchEntity(args.ref, undefined, args.namespace);
  if (isErr(fetchResult)) return fetchResult;
  const entity = fetchResult.data;

  const navigationResult = await loadNavigation(kg, args.namespace);
  if (isErr(navigationResult)) return navigationResult;

  const schemaResult = await kg.getSchema(args.namespace);
  if (isErr(schemaResult)) return schemaResult;

  const locationResult = await findEntityLocation(
    fs,
    config.paths,
    schemaResult.data,
    entity,
    navigationResult.data,
  );
  if (isErr(locationResult)) return locationResult;

  if (!locationResult.data) {
    return fail("location-not-found", `No file location for: ${args.ref}`);
  }

  const { filePath } = locationResult.data;
  ui.println(`${filePath}`);

  return ok(undefined);
};

export const LocateCommand = types({
  command: "locate <ref>",
  describe: "print file path and line number for an entity",
  builder: (yargs: Argv) =>
    yargs
      .positional("ref", {
        describe: "entity reference (uid | key)",
        type: "string",
        demandOption: true,
        coerce: (value: string) => normalizeEntityRef(value),
      })
      .options(namespaceOption),
  handler: runtimeWithDb(locateHandler),
});
