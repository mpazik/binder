import type { Argv } from "yargs";
import { fail, isErr, ok } from "@binder/utils";
import {
  type Fieldset,
  type Includes,
  type NamespaceEditable,
  type ReadonlyKnowledgeGraph,
  type OrderBy,
  type QueryParams,
  QueryParamsSchema,
  parseSerialFilters,
} from "@binder/repo";
import {
  type CommandHandlerReadonly,
  runtimeWithReadonlyRepo,
} from "../runtime.ts";
import { types } from "../cli/types.ts";
import {
  fieldsOption,
  limitOption,
  listFormatOption,
  namespaceOption,
  orderByOption,
} from "../cli/options.ts";
import { type SerializeFormat, flatListFormats } from "../utils/serialize.ts";
import { applySelection } from "../utils/selection.ts";
import { isStdinPiped, readStdinAs } from "../cli/stdin.ts";
import { formatReferencesList } from "../document/reference.ts";

const resolveFormattedItems = async (
  kg: ReadonlyKnowledgeGraph,
  items: Fieldset[],
  namespace: NamespaceEditable,
) => {
  const schemaResult = await kg.getSchema(namespace);
  if (isErr(schemaResult)) return schemaResult;
  return formatReferencesList(items, schemaResult.data, kg);
};

const searchHandler: CommandHandlerReadonly<{
  query: string[];
  namespace: NamespaceEditable;
  format?: SerializeFormat;
  limit?: number;
  fields?: Includes;
  orderBy?: OrderBy;
}> = async ({ kg, ui, args }) => {
  let query: QueryParams;

  if (isStdinPiped()) {
    const hasArgs =
      args.query.length > 0 ||
      args.fields !== undefined ||
      args.orderBy !== undefined;

    if (hasArgs)
      return fail(
        "conflicting-input",
        "Cannot combine stdin with positional arguments or query options. Put filters, includes, and orderBy in the JSON payload instead.",
      );

    const stdinResult = await readStdinAs(QueryParamsSchema);
    if (isErr(stdinResult)) return stdinResult;

    query = {
      ...stdinResult.data,
      pagination: {
        ...stdinResult.data.pagination,
        limit: args.limit ?? stdinResult.data.pagination?.limit,
      },
    };
  } else {
    query = {
      filters: parseSerialFilters(args.query),
      includes: args.fields,
      orderBy: args.orderBy,
    };
  }

  const result = await kg.search(query, args.namespace);
  if (isErr(result)) return result;

  const items = applySelection(result.data.items, { limit: args.limit });
  const formatted = await resolveFormattedItems(kg, items, args.namespace);
  if (isErr(formatted)) return formatted;

  const data = flatListFormats.includes(args.format!)
    ? formatted.data
    : { ...result.data, items: formatted.data };
  ui.printData(data, args.format);

  // query_length only reported for argv queries; stdin payloads are opaque by design.
  const telemetry: Record<string, unknown> = { result_count: items.length };
  if (!isStdinPiped() && args.query.length > 0) {
    telemetry.query_length = args.query.join(" ").length;
  }
  return ok({ telemetry });
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
        ...fieldsOption,
        ...orderByOption,
      }),
  handler: runtimeWithReadonlyRepo(searchHandler),
});
