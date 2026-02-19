import {
  type Includes,
  type NamespaceEditable,
  type OrderBy,
  namespacesEditable,
  parseSerialIncludes,
  parseSerialOrderBy,
} from "@binder/db";
import { throwIfError } from "@binder/utils";
import { serializeFormats, serializeItemFormats } from "../utils/serialize.ts";

export const namespaceOption = {
  namespace: {
    alias: "n",
    describe: "namespace",
    choices: namespacesEditable,
    default: "record" as NamespaceEditable,
  },
} as const;

export const itemFormatOption = {
  format: {
    describe: "output format",
    type: "string",
    choices: serializeItemFormats,
  },
} as const;

export const listFormatOption = {
  format: {
    describe: "output format",
    type: "string",
    choices: serializeFormats,
  },
} as const;

export const dryRunOption = {
  "dry-run": {
    alias: "d",
    describe: "preview changes without applying",
    type: "boolean",
    default: false,
  },
} as const;

export const yesOption = {
  yes: {
    alias: "y",
    describe: "skip confirmation prompts",
    type: "boolean",
    default: false,
  },
} as const;

export const limitOption = {
  limit: {
    describe: "maximum number of items",
    type: "number",
  },
} as const;

export const lastOption = {
  last: {
    describe: "take last N items",
    type: "number",
  },
} as const;

export const skipOption = {
  skip: {
    describe: "skip first N items",
    type: "number",
  },
} as const;

export const selectionOptions = {
  ...limitOption,
  ...lastOption,
  ...skipOption,
} as const;

export type SelectionArgs = {
  limit?: number;
  last?: number;
  skip?: number;
};

export const includeOption = {
  include: {
    alias: "i",
    describe: "fields to include (e.g. project(title,status),tags)",
    type: "string",
    coerce: (value: string): Includes =>
      throwIfError(parseSerialIncludes(value)),
  },
} as const;

export const orderByOption = {
  orderBy: {
    alias: "o",
    describe: "sort order (e.g. !priority,createdAt)",
    type: "string",
    coerce: parseSerialOrderBy,
  },
} as const;
