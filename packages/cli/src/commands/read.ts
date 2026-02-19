import type { Argv } from "yargs";
import { z } from "zod";
import { fail, isErr, ok } from "@binder/utils";
import {
  type EntityRef,
  type Includes,
  IncludesSchema,
  type NamespaceEditable,
  normalizeEntityRef,
} from "@binder/db";
import { type CommandHandlerWithDb, runtimeWithDb } from "../runtime.ts";
import { types } from "../cli/types.ts";
import {
  includeOption,
  itemFormatOption,
  namespaceOption,
} from "../cli/options.ts";
import type { SerializeItemFormat } from "../utils/serialize.ts";
import { isStdinPiped, readStdinAs } from "../cli/stdin.ts";

const ReadStdinSchema = z.object({
  includes: IncludesSchema.optional(),
});

const readHandler: CommandHandlerWithDb<{
  ref: EntityRef;
  namespace: NamespaceEditable;
  format?: SerializeItemFormat;
  include?: Includes;
}> = async ({ kg, ui, args }) => {
  if (isStdinPiped()) {
    if (args.include !== undefined)
      return fail(
        "conflicting-input",
        "Cannot combine stdin with --include option",
      );

    const stdinResult = await readStdinAs(ReadStdinSchema);
    if (isErr(stdinResult)) return stdinResult;

    const result = await kg.fetchEntity(
      args.ref,
      stdinResult.data.includes,
      args.namespace,
    );
    if (isErr(result)) return result;

    ui.printData(result.data, args.format);
    return ok(undefined);
  }

  const result = await kg.fetchEntity(args.ref, args.include, args.namespace);
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
      .options({ ...namespaceOption, ...itemFormatOption, ...includeOption }),
  handler: runtimeWithDb(readHandler),
});
