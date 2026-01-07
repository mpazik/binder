import type { Argv } from "yargs";
import { isErr, ok } from "@binder/utils";
import {
  type EntityRef,
  type NamespaceEditable,
  normalizeEntityRef,
} from "@binder/db";
import { type CommandHandlerWithDb, runtimeWithDb } from "../runtime.ts";
import { types } from "../cli/types.ts";
import { itemFormatOption, namespaceOption } from "../cli/options.ts";
import type { SerializeItemFormat } from "../utils/serialize.ts";

const readHandler: CommandHandlerWithDb<{
  ref: EntityRef;
  namespace: NamespaceEditable;
  format?: SerializeItemFormat;
}> = async ({ kg, ui, args }) => {
  const result = await kg.fetchEntity(args.ref, undefined, args.namespace);
  if (isErr(result)) return result;

  ui.printData(result.data, args.format);
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
      .options({ ...namespaceOption, ...itemFormatOption }),
  handler: runtimeWithDb(readHandler),
});
