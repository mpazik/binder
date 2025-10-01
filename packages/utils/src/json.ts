import { type Result, tryCatch } from "./result.ts";
import { createError, serializeErrorData } from "./error.ts";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | readonly JsonValue[]
  | JsonObject;
export type JsonObject = { readonly [key: string]: JsonValue };

export const parseJson = <T>(text: string): Result<T> =>
  tryCatch(
    () => JSON.parse(text) as T,
    (error) =>
      createError(
        "invalid-json",
        `Failed to parse JSON`,
        serializeErrorData(error),
      ),
  );

export const stringifyJson = <T>(data: T): string => JSON.stringify(data);
