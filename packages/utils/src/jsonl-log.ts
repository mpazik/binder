import type { FileSystem } from "./filesystem.ts";
import { parseJson } from "./json.ts";
import { fail } from "./error.ts";
import { isErr, ok, okVoid, type Result, type ResultAsync } from "./result.ts";

/**
 * Generic append-only JSONL log file IO. Each item is stored as one JSON line.
 * These primitives carry no domain semantics — callers supply `parse` /
 * `serialize` (defaulting to `JSON.parse` / `JSON.stringify`) and any filtering.
 */

/** Minimal file-system surface these primitives need. */
export type JsonlLogFs = Pick<
  FileSystem,
  "stat" | "slice" | "appendFile" | "truncate" | "writeFile"
>;

const CHUNK_SIZE = 65536;

const defaultParse = <T>(line: string): Result<T> =>
  parseJson<T>(line, "Failed to parse JSON log line");

const defaultSerialize = <T>(item: T): string => JSON.stringify(item);

/**
 * Yields raw (untrimmed-of-meaning) log lines from the end of the file towards
 * the beginning, along with the byte offset where each line begins.
 */
const rawLinesFromEnd = async function* (
  fs: JsonlLogFs,
  path: string,
): AsyncGenerator<
  Result<{ line: string; bytePositionBefore: number }>,
  void,
  unknown
> {
  const statResult = fs.stat(path);
  if (isErr(statResult)) return;

  const fileSize = statResult.data.size;
  if (fileSize === 0) return;

  let position = fileSize;
  let partialLine = "";
  const encoder = new TextEncoder();

  while (position > 0) {
    const readStart = Math.max(position - CHUNK_SIZE, 0);
    const sliceResult = await fs.slice(path, readStart, position);
    if (isErr(sliceResult)) {
      yield fail("file-read-error", "Failed to read log file", {
        data: { path, error: sliceResult.error },
      });
      return;
    }

    const chunk = new TextDecoder().decode(sliceResult.data);
    const chunkLines = chunk.split("\n");

    if (position < fileSize) {
      chunkLines[chunkLines.length - 1] =
        chunkLines[chunkLines.length - 1]! + partialLine;
    }

    if (readStart > 0) {
      partialLine = chunkLines[0]!;
      chunkLines.shift();
    }

    let bytesProcessed = 0;
    for (let i = chunkLines.length - 1; i >= 0; i--) {
      const line = chunkLines[i]!;
      const trimmedLine = line.trim();

      if (trimmedLine.length > 0) {
        const lineBytes = encoder.encode(line + "\n");
        const bytePositionBefore = position - bytesProcessed - lineBytes.length;
        yield ok({ line: trimmedLine, bytePositionBefore });
        bytesProcessed += lineBytes.length;
      }
    }

    position = readStart;
  }
};

/** Yields raw log lines from the beginning of the file towards the end. */
const rawLinesFromBeginning = async function* (
  fs: JsonlLogFs,
  path: string,
): AsyncGenerator<Result<string>, void, unknown> {
  const statResult = fs.stat(path);
  if (isErr(statResult)) return;

  const fileSize = statResult.data.size;
  if (fileSize === 0) return;

  let position = 0;
  let partialLine = "";

  while (position < fileSize) {
    const readEnd = Math.min(position + CHUNK_SIZE, fileSize);
    const sliceResult = await fs.slice(path, position, readEnd);
    if (isErr(sliceResult)) {
      yield fail("file-read-error", "Failed to read log file", {
        data: { path, error: sliceResult.error },
      });
      return;
    }

    const chunk = new TextDecoder().decode(sliceResult.data);
    const chunkLines = (partialLine + chunk).split("\n");

    if (readEnd < fileSize) {
      partialLine = chunkLines.pop()!;
    } else {
      partialLine = "";
    }

    for (const line of chunkLines) {
      const trimmedLine = line.trim();
      if (trimmedLine.length > 0) {
        yield ok(trimmedLine);
      }
    }

    position = readEnd;
  }

  if (partialLine.trim().length > 0) {
    yield ok(partialLine.trim());
  }
};

/** Parses and yields items from the end of the log towards the beginning. */
export const readLinesFromEnd = async function* <T>(
  fs: JsonlLogFs,
  path: string,
  parse: (line: string) => Result<T> = defaultParse,
): AsyncGenerator<Result<T>, void, unknown> {
  for await (const result of rawLinesFromEnd(fs, path)) {
    if (isErr(result)) yield result;
    else yield parse(result.data.line);
  }
};

/** Parses and yields items from the beginning of the log towards the end. */
export const readLinesFromBeginning = async function* <T>(
  fs: JsonlLogFs,
  path: string,
  parse: (line: string) => Result<T> = defaultParse,
): AsyncGenerator<Result<T>, void, unknown> {
  for await (const result of rawLinesFromBeginning(fs, path)) {
    if (isErr(result)) yield result;
    else yield parse(result.data);
  }
};

/** Appends a single item as one JSON line. */
export const appendLine = <T>(
  fs: JsonlLogFs,
  path: string,
  item: T,
  serialize: (item: T) => string = defaultSerialize,
): ResultAsync<void> => fs.appendFile(path, serialize(item) + "\n");

/** Appends multiple items, one JSON line each, in order. */
export const appendLines = async <T>(
  fs: JsonlLogFs,
  path: string,
  items: T[],
  serialize: (item: T) => string = defaultSerialize,
): ResultAsync<void> => {
  for (const item of items) {
    const result = await appendLine(fs, path, item, serialize);
    if (isErr(result)) return result;
  }
  return okVoid;
};

/** Reads the last `count` items, returned in oldest-first order. */
export const readLastLines = async <T>(
  fs: JsonlLogFs,
  path: string,
  count: number,
  parse: (line: string) => Result<T> = defaultParse,
): ResultAsync<T[]> => {
  if (count === 0) return ok([]);

  const items: T[] = [];
  for await (const result of readLinesFromEnd(fs, path, parse)) {
    if (isErr(result)) return result;
    items.push(result.data);
    if (items.length >= count) break;
  }

  return ok(items.reverse());
};

/**
 * Reads up to `count` items, optionally filtered, in the requested order
 * (`desc` = newest-first, the default; `asc` = oldest-first). Counting happens
 * after filtering.
 */
export const readLines = async <T>(
  fs: JsonlLogFs,
  path: string,
  count: number,
  options: {
    parse?: (line: string) => Result<T>;
    filter?: (item: T) => boolean;
    order?: "asc" | "desc";
  } = {},
): ResultAsync<T[]> => {
  if (count === 0) return ok([]);

  const { parse = defaultParse, filter, order = "desc" } = options;
  const generator =
    order === "asc"
      ? readLinesFromBeginning(fs, path, parse)
      : readLinesFromEnd(fs, path, parse);

  const items: T[] = [];
  for await (const result of generator) {
    if (isErr(result)) return result;
    if (filter && !filter(result.data)) continue;
    items.push(result.data);
    if (items.length >= count) break;
  }
  return ok(items);
};

/**
 * Reads items (oldest-first) whose numeric key falls within `[from, to]`.
 * Assumes keys are non-decreasing in file order, so iteration stops once a key
 * exceeds `to`.
 */
export const readLineRange = async <T>(
  fs: JsonlLogFs,
  path: string,
  options: {
    getKey: (item: T) => number;
    parse?: (line: string) => Result<T>;
    from?: number;
    to?: number;
  },
): ResultAsync<T[]> => {
  const { getKey, parse = defaultParse, from, to } = options;
  const items: T[] = [];

  for await (const result of readLinesFromBeginning(fs, path, parse)) {
    if (isErr(result)) return result;

    const key = getKey(result.data);
    if (from !== undefined && key < from) continue;
    if (to !== undefined && key > to) break;

    items.push(result.data);
  }

  return ok(items);
};

/** Truncates the last `count` lines from the log. */
export const removeLastLines = async (
  fs: JsonlLogFs,
  path: string,
  count: number,
): ResultAsync<void> => {
  let truncatePosition = 0;
  let linesFound = 0;

  for await (const result of rawLinesFromEnd(fs, path)) {
    if (isErr(result)) return result;

    linesFound++;
    if (linesFound === count) {
      truncatePosition = result.data.bytePositionBefore;
      break;
    }
  }

  if (count > linesFound)
    return fail(
      "invalid-count",
      `Cannot remove ${count} lines, only ${linesFound} available in log`,
    );

  return fs.truncate(path, truncatePosition);
};

/** Empties the log file. */
export const clearLog = (fs: JsonlLogFs, path: string): ResultAsync<void> =>
  fs.writeFile(path, "");
