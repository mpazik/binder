import type { Argv } from "yargs";
import { isErr, ok } from "@binder/utils";
import { type NamespaceEditable, parseSerialFilters } from "@binder/db";
import { type CommandHandlerWithDb, runtimeWithDb } from "../runtime.ts";
import { types } from "../cli/types.ts";
import {
  limitOption,
  listFormatOption,
  namespaceOption,
} from "../cli/options.ts";
import type { SerializeFormat } from "../utils/serialize.ts";
import { applySelection } from "../utils/selection.ts";

const searchHandler: CommandHandlerWithDb<{
  query: string[];
  namespace: NamespaceEditable;
  format?: SerializeFormat;
  limit?: number;
}> = async ({ kg, ui, args }) => {
  const filters = parseSerialFilters(args.query);

  const result = await kg.search({ filters }, args.namespace);
  if (isErr(result)) return result;

  const items = applySelection(result.data.items, { limit: args.limit });
  const data = args.format === "jsonl" ? items : { ...result.data, items };
  ui.printData(data, args.format);
  return ok(undefined);
};

export const SearchCommand = types({
  command: "search [query..]",
  describe: "search using quick DSL (plain text or key=value)",
  builder: (yargs: Argv) =>
    yargs
      .positional("query", {
        describe: "search query (plain strings or key=value pairs)",
        type: "string",
        array: true,
        default: [],
      })
      .options({ ...namespaceOption, ...listFormatOption, ...limitOption }),
  handler: runtimeWithDb(searchHandler),
});
