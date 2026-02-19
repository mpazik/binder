import type { Argv } from "yargs";
import { fail, isErr, ok } from "@binder/utils";
import {
  type Includes,
  type NamespaceEditable,
  type OrderBy,
  type QueryParams,
  QueryParamsSchema,
  parseSerialFilters,
} from "@binder/db";
import { type CommandHandlerWithDb, runtimeWithDb } from "../runtime.ts";
import { types } from "../cli/types.ts";
import {
  includeOption,
  limitOption,
  listFormatOption,
  namespaceOption,
  orderByOption,
} from "../cli/options.ts";
import type { SerializeFormat } from "../utils/serialize.ts";
import { applySelection } from "../utils/selection.ts";
import { isStdinPiped, readStdinAs } from "../cli/stdin.ts";

const searchHandler: CommandHandlerWithDb<{
  query: string[];
  namespace: NamespaceEditable;
  format?: SerializeFormat;
  limit?: number;
  include?: Includes;
  orderBy?: OrderBy;
}> = async ({ kg, ui, args }) => {
  const hasArgs =
    args.query.length > 0 ||
    args.include !== undefined ||
    args.orderBy !== undefined;

  if (isStdinPiped()) {
    if (hasArgs)
      return fail(
        "conflicting-input",
        "Cannot combine stdin with positional arguments or query options",
      );

    const queryResult = await readStdinAs(QueryParamsSchema);
    if (isErr(queryResult)) return queryResult;

    const query: QueryParams = {
      ...queryResult.data,
      pagination: {
        ...queryResult.data.pagination,
        limit: args.limit ?? queryResult.data.pagination?.limit,
      },
    };

    const result = await kg.search(query, args.namespace);
    if (isErr(result)) return result;

    const items = applySelection(result.data.items, { limit: args.limit });
    const data = args.format === "jsonl" ? items : { ...result.data, items };
    ui.printData(data, args.format);
    return ok(undefined);
  }

  const filters = parseSerialFilters(args.query);

  const result = await kg.search(
    { filters, includes: args.include, orderBy: args.orderBy },
    args.namespace,
  );
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
      .options({
        ...namespaceOption,
        ...listFormatOption,
        ...limitOption,
        ...includeOption,
        ...orderByOption,
      }),
  handler: runtimeWithDb(searchHandler),
});
