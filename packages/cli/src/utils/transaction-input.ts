import * as YAML from "yaml";
import {
  fail,
  isErr,
  ok,
  tryCatch,
  type Result,
  type ResultAsync,
} from "@binder/utils";
import {
  isValueChange,
  TransactionInputSchema,
  type EntityChangesetInput,
  type FieldChangeInput,
  type FieldChangeset,
  type FieldChangesetInput,
  type FieldValue,
  type ListMutation,
  type ListMutationInput,
  type Transaction,
  type TransactionInput,
  type ValueChange,
} from "@binder/db";
import type { FileSystem } from "../lib/filesystem.ts";

export type TransactionInputFormat = "yaml" | "json" | "jsonl";

export const detectFileFormat = (path: string): TransactionInputFormat => {
  if (path.endsWith(".yaml") || path.endsWith(".yml")) return "yaml";
  if (path.endsWith(".jsonl")) return "jsonl";
  return "json";
};

const valueChangeToInput = (change: ValueChange): FieldChangeInput => {
  if (change[0] === "set") return change[1];
  if (change[0] === "clear") return null;
  if (change[0] === "seq")
    return change[1].map((m: ListMutation) =>
      m[0] === "patch"
        ? ([m[0], m[1], changesetToInput(m[2])] as ListMutationInput)
        : m,
    );
  if (change[0] === "patch") return changesetToInput(change[1]) as FieldValue;
  return change[1];
};

const changesetToInput = (changeset: FieldChangeset): FieldChangesetInput => {
  const result: FieldChangesetInput = {};
  for (const [key, value] of Object.entries(changeset)) {
    if (key === "id") continue;
    result[key] = isValueChange(value)
      ? valueChangeToInput(value)
      : (value as FieldChangeInput);
  }
  return result;
};

export const transactionToInput = (tx: Transaction): TransactionInput => {
  const nodes: EntityChangesetInput<"node">[] = [];
  for (const [uid, changeset] of Object.entries(tx.nodes)) {
    const input = changesetToInput(changeset);
    if ("type" in input) {
      nodes.push(input as EntityChangesetInput<"node">);
    } else {
      nodes.push({ $ref: uid, ...input } as EntityChangesetInput<"node">);
    }
  }

  const configurations: EntityChangesetInput<"config">[] = [];
  for (const [key, changeset] of Object.entries(tx.configurations)) {
    const input = changesetToInput(changeset);
    if ("type" in input) {
      configurations.push(input as EntityChangesetInput<"config">);
    } else {
      configurations.push({
        $ref: key,
        ...input,
      } as EntityChangesetInput<"config">);
    }
  }

  return {
    author: tx.author,
    createdAt: tx.createdAt,
    ...(nodes.length > 0 && { nodes }),
    ...(configurations.length > 0 && { configurations }),
  };
};

export const parseTransactionInputContent = (
  content: string,
  format: TransactionInputFormat,
  defaultAuthor: string,
): Result<TransactionInput[]> => {
  const parseResult =
    format === "jsonl"
      ? tryCatch(() =>
          content
            .split("\n")
            .filter((line) => line.trim())
            .map((line) => JSON.parse(line) as Record<string, unknown>),
        )
      : format === "json"
        ? tryCatch(() => {
            const parsed = JSON.parse(content) as
              | Record<string, unknown>
              | Record<string, unknown>[];
            return Array.isArray(parsed) ? parsed : [parsed];
          })
        : tryCatch(() => {
            const parsed = YAML.parse(content) as
              | Record<string, unknown>
              | Record<string, unknown>[];
            return Array.isArray(parsed) ? parsed : [parsed];
          });

  if (isErr(parseResult))
    return fail("parse-error", `Failed to parse ${format} content`, {
      error: parseResult.error,
    });

  const transactions: TransactionInput[] = [];

  for (const raw of parseResult.data) {
    const txResult = tryCatch(() =>
      TransactionInputSchema.parse({
        ...raw,
        author: raw.author ?? defaultAuthor,
      }),
    );

    if (isErr(txResult))
      return fail("validation-error", "Invalid transaction format", {
        error: txResult.error,
      });

    transactions.push(txResult.data);
  }

  return ok(transactions);
};

export const parseTransactionInputFile = async (
  fs: FileSystem,
  path: string,
  defaultAuthor: string,
): ResultAsync<TransactionInput[]> => {
  const contentResult = await fs.readFile(path);
  if (isErr(contentResult))
    return fail("file-read-error", "Failed to read file", {
      path,
      error: contentResult.error,
    });

  const format = detectFileFormat(path);
  const parseResult = parseTransactionInputContent(
    contentResult.data,
    format,
    defaultAuthor,
  );

  if (isErr(parseResult))
    return fail(parseResult.error.key, parseResult.error.message, {
      path,
      ...parseResult.error.data,
    });

  return parseResult;
};

export const serializeTransactionInputs = (
  inputs: TransactionInput[],
  format: TransactionInputFormat,
): string => {
  const cleaned = inputs.map((input) => ({
    author: input.author,
    ...(input.createdAt && { createdAt: input.createdAt }),
    ...(input.nodes && input.nodes.length > 0 && { nodes: input.nodes }),
    ...(input.configurations &&
      input.configurations.length > 0 && {
        configurations: input.configurations,
      }),
  }));

  if (format === "jsonl")
    return cleaned.map((tx) => JSON.stringify(tx)).join("\n");

  if (format === "json") return JSON.stringify(cleaned, null, 2);

  return YAML.stringify(cleaned);
};
