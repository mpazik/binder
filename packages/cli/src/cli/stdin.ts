import { fstatSync } from "node:fs";
import type { ZodType } from "zod";
import {
  isErr,
  ok,
  type Result,
  resultFallback,
  tryCatch,
  wrapError,
} from "@binder/utils";
import { parseContent, type InputFormat } from "../utils/parse.ts";

/**
 * We use fstatSync(0) directly instead of `process.stdin.isTTY` because the Bun bundler transforms the latter into `fstatSync(0).isFIFO()`,
 * That work only for Pipe but misses sockets used in `execSync({ input })`.
 */
export const isStdinPiped = (): boolean => {
  return resultFallback(
    tryCatch(() => {
      const stat = fstatSync(0);
      return stat.isFIFO() || stat.isSocket();
    }),
    false,
  );
};

export const readStdin = async (): Promise<Result<string>> => {
  const result = await tryCatch(Bun.stdin.text());
  if (isErr(result))
    return wrapError(result, "stdin-read-error", "Failed to read from stdin");
  return ok(result.data);
};

export const parseStdinAs = async <T>(
  schema: ZodType<T>,
  format?: InputFormat,
  mapItem?: (item: unknown) => unknown,
): Promise<Result<T[]>> => {
  const contentResult = await readStdin();
  if (isErr(contentResult)) return contentResult;
  return parseContent(contentResult.data, schema, format, mapItem);
};
