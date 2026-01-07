import type { Argv } from "yargs";
import { isErr, ok } from "@binder/utils";
import {
  type EntityRef,
  type NamespaceEditable,
  normalizeEntityRef,
} from "@binder/db";
import { runtimeWithDb, type CommandHandlerWithDb } from "../runtime.ts";
import { types } from "./types.ts";
import { formatOption, namespaceOption, type OutputFormat } from "./options.ts";

const readHandler: CommandHandlerWithDb<{
  ref: EntityRef;
  namespace: NamespaceEditable;
  format: OutputFormat;
}> = async ({ kg, ui, args }) => {
  const result = await kg.fetchEntity(args.ref, undefined, args.namespace);
  if (isErr(result)) return result;

  ui.printData(result.data, args.format);
  return ok(undefined);
};

const ReadCommand = types({
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
      .options({ ...namespaceOption, ...formatOption }),
  handler: runtimeWithDb(readHandler),
});

export default ReadCommand;
