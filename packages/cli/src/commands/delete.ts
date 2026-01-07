import type { Argv } from "yargs";
import { ok } from "@binder/utils";
import {
  type EntityRef,
  type NamespaceEditable,
  normalizeEntityRef,
} from "@binder/db";
import { runtimeWithDb, type CommandHandlerWithDb } from "../runtime.ts";
import { types } from "./types.ts";
import { namespaceOption } from "./options.ts";

const deleteHandler: CommandHandlerWithDb<{
  ref: EntityRef;
  namespace: NamespaceEditable;
}> = async ({ args }) => {
  return ok(`Delete not yet implemented for ${args.namespace}: ${args.ref}`);
};

const DeleteCommand = types({
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

export default DeleteCommand;
