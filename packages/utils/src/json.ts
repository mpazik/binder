import { type Result, tryCatch } from "./result.ts";
import { createError, serializeErrorData } from "./error.ts";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | readonly JsonValue[]
  | JsonObject;
export type JsonObject = { readonly [key: string]: JsonValue };

export const parseJson = <T>(
  text: string,
  message = `Failed to parse JSON`,
): Result<T> =>
  tryCatch(
    () => JSON.parse(text) as T,
    (error) => createError("invalid-json", message, serializeErrorData(error)),
  );

export const stringifyJson = <T>(data: T): string => JSON.stringify(data);
