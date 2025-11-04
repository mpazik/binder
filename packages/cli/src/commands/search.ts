import type { Argv } from "yargs";
import { isErr, ok } from "@binder/utils";
import type { Filters } from "@binder/db";
import {
  bootstrapWithDbRead,
  bootstrapWithDbWrite,
  type CommandHandlerWithDbRead,
  type CommandHandlerWithDbWrite,
} from "../bootstrap.ts";
import { types } from "./types.ts";

const parseQuery = (queryParts: string[]): Filters => {
  const filters: Filters = {};
  const plainTextParts: string[] = [];

  for (const part of queryParts) {
    const equalIndex = part.indexOf("=");
    if (equalIndex === -1) {
      plainTextParts.push(part);
      continue;
    }

    const key = part.slice(0, equalIndex);
    const value = part.slice(equalIndex + 1);

    if (value === "true") {
      filters[key] = true;
    } else if (value === "false") {
      filters[key] = false;
    } else if (/^-?\d+$/.test(value)) {
      filters[key] = parseInt(value, 10);
    } else if (/^-?\d+\.\d+$/.test(value)) {
      filters[key] = parseFloat(value);
    } else {
      filters[key] = value;
    }
  }

  if (plainTextParts.length > 0) {
    filters["$text"] = plainTextParts.join(" ");
  }

  return filters;
};

const searchHandler: CommandHandlerWithDbRead<{
  query: string[];
}> = async ({ kg, ui, args }) => {
  const filters = parseQuery(args.query);

  const result = await kg.search({ filters });
  if (isErr(result)) return result;

  ui.printData(result.data);
  return ok(undefined);
};

export const SearchCommand = types({
  command: "search [query..]",
  describe: "search using quick DSL (plain text or key=value)",
  builder: (yargs: Argv) => {
    return yargs.positional("query", {
      describe: "search query (plain strings or key=value pairs)",
      type: "string",
      array: true,
      default: [],
    });
  },
  handler: bootstrapWithDbRead(searchHandler),
});
