import type { Argv } from "yargs";
import { isErr, okVoid } from "@binder/utils";
import {
  createTransactionInput,
  type EntityRef,
  type NamespaceEditable,
  normalizeEntityRef,
} from "@binder/repo";
import { type CommandHandlerWithDb, runtimeWithDb } from "../runtime.ts";

import { namespaceOption } from "../cli/options.ts";
import { types } from "../cli/types.ts";

const deleteHandler: CommandHandlerWithDb<{
  ref: EntityRef;
  namespace: NamespaceEditable;
}> = async ({ kg, config, ui, args }) => {
  const result = await kg.update(
    createTransactionInput(config.author, args.namespace, [
      { $ref: args.ref, $delete: true },
    ]),
  );
  if (isErr(result)) return result;

  await ui.printTransaction(kg, result.data);
  return okVoid;
};

export const DeleteCommand = types({
  command: "delete <ref>",
  aliases: ["remove"],
  describe: "delete by reference",
  builder: (yargs: Argv) =>
    yargs
      .positional("ref", {
        describe: "reference (id | uid | key)",
        type: "string",
        demandOption: true,
        coerce: (value: string) => normalizeEntityRef(value),
      })
      .options(namespaceOption),
  handler: runtimeWithDb(deleteHandler),
});
