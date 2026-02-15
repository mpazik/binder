import { type NamespaceEditable, namespacesEditable } from "@binder/db";
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
