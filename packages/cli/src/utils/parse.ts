import * as YAML from "yaml";
import type { ZodType } from "zod";
import {
  isErr,
  isOk,
  ok,
  parseJson,
  type Result,
  tryCatch,
  wrapError,
} from "@binder/utils";
import { type TransactionInput, TransactionInputSchema } from "@binder/db";
import type { SerializeFormat } from "./serialize.ts";

export type InputFormat = "yaml" | "json" | "jsonl";

export const detectFileFormat = (path: string): SerializeFormat => {
  if (path.endsWith(".yaml") || path.endsWith(".yml")) return "yaml";
  if (path.endsWith(".jsonl")) return "jsonl";
  return "json";
};

export const detectContentFormat = (content: string): InputFormat => {
  const trimmed = content.trim();

  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return "yaml";

  if (isOk(parseJson(trimmed))) return "json";

  const lines = trimmed.split("\n").filter((line) => line.trim());
  if (lines.length > 1 && lines[0]!.trim().startsWith("{")) {
    if (isOk(parseJson(lines[0]!))) return "jsonl";
  }

  return "yaml";
};

const parseJsonl = (content: string): Result<unknown[]> => {
  const lines = content.split("\n").filter((line) => line.trim());
  const results: unknown[] = [];
  for (const line of lines) {
    const result = parseJson(line);
    if (isErr(result))
      return wrapError(result, "parse-error", "Failed to parse JSONL line", {
        line,
      });
    results.push(result.data);
  }
  return ok(results);
};

const parseJsonArray = (content: string): Result<unknown[]> => {
  const result = parseJson<unknown>(content);
  if (isErr(result)) return result;
  return ok(Array.isArray(result.data) ? result.data : [result.data]);
};

const parseYamlArray = (content: string): Result<unknown[]> => {
  const result = tryCatch(() => YAML.parse(content) as unknown);
  if (isErr(result))
    return wrapError(result, "parse-error", "Failed to parse YAML");
  return ok(Array.isArray(result.data) ? result.data : [result.data]);
};

export const parseContentToArray = (
  content: string,
  format?: InputFormat,
): Result<unknown[]> => {
  const resolvedFormat = format ?? detectContentFormat(content);

  if (resolvedFormat === "jsonl") return parseJsonl(content);
  if (resolvedFormat === "json") return parseJsonArray(content);
  return parseYamlArray(content);
};

export const parseContent = <T>(
  content: string,
  itemSchema: ZodType<T>,
  format?: InputFormat,
  mapItem?: (item: unknown) => unknown,
): Result<T[]> => {
  const rawResult = parseContentToArray(content, format);
  if (isErr(rawResult)) return rawResult;

  const items: T[] = [];
  for (const raw of rawResult.data) {
    const mapped = mapItem ? mapItem(raw) : raw;
    const validationResult = tryCatch(() => itemSchema.parse(mapped));
    if (isErr(validationResult))
      return wrapError(
        validationResult,
        "validation-error",
        "Invalid item format",
      );
    items.push(validationResult.data);
  }

  return ok(items);
};

export const parseTransactionInputContent = (
  content: string,
  format: InputFormat | undefined,
  defaultAuthor: string,
): Result<TransactionInput[]> =>
  parseContent(content, TransactionInputSchema, format, (raw) => {
    const record = raw as Record<string, unknown>;
    return { ...record, author: record.author ?? defaultAuthor };
  });
