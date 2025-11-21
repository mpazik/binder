// Error keys are used to identify the type of error that occurred. They are in kebab-case.
import { err, type Err, type Result } from "./result.ts";

export type ErrorKey = string;

export type ErrorObject<T extends object = object> = {
  key: ErrorKey;
  message?: string;
  data: T;
};

/**
 * Creates an ErrorObject from an error.
 *
 * @param key - error key in kebab-case.
 * @param message - error message.
 * @param data - error data.
 */
export const createError = <T extends object = object>(
  key: ErrorKey,
  message?: string,
  data?: T,
): ErrorObject<T> => ({
  key,
  message,
  data: serializeErrorData<T>(data),
});

export const isErrorObject = (error: unknown): error is ErrorObject => {
  return (
    typeof error === "object" &&
    error !== null &&
    "key" in error &&
    "data" in error &&
    typeof (error as ErrorObject).data === "object"
  );
};

export const serializeErrorData = <T extends object = object>(
  error: unknown,
): T => {
  if (error instanceof Error && error.stack) {
    return { stack: error.stack } as T;
  }
  if (typeof error === "object" && error !== null) {
    return error as T;
  }
  return {} as T;
};

export const errorToObject = (error: unknown, name?: string): ErrorObject => {
  if (error instanceof Error) {
    return createError(
      name ?? error.name,
      error.message,
      serializeErrorData(error),
    );
  }
  return createError(name ?? "unknown", String(error));
};

const rewrapError = <T extends object>(
  error: Err<ErrorObject<T>>,
  key = error.error.key,
  message = error.error.message,
  data?: T,
): Err<ErrorObject<T>> =>
  err(
    createError(key, message, {
      ...error.error.data,
      data,
    }),
  );

export default rewrapError;

export const stringifyErrorObject = (error: ErrorObject): string =>
  `${error.key}: ${error.message}`;

// Can not be just `reportError` as it would conflict with the global `reportError` function
export const reportErrorObject = (error: ErrorObject) => {
  console.error(
    `${error.key}: ${error.message}`,
    JSON.stringify(error.data, null, 2),
  );
};

export const reportWarning = (message: string, data?: object) => {
  console.warn(message, JSON.stringify(data, null, 2));
};

export const reportErrorAsWarning = (error: ErrorObject) => {
  console.warn(
    `Ignoring error: ${error.key}: ${error.message}`,
    JSON.stringify(error.data, null, 2),
  );
};

export const throwIfUndefined = <T>(
  value: T | undefined,
  messageSupplier?: () => string,
): T => {
  if (value !== undefined) return value;
  // eslint-disable-next-line no-restricted-syntax
  if (messageSupplier) throw new Error(messageSupplier());
  // eslint-disable-next-line no-restricted-syntax
  throw new Error(`Expected value to be defined`);
};

export const throwIfNull = <T>(
  value: T | null | undefined,
  messageSupplier?: () => string,
): T => {
  if (value !== undefined && value !== null) return value;
  // eslint-disable-next-line no-restricted-syntax
  if (messageSupplier) throw new Error(messageSupplier());
  // eslint-disable-next-line no-restricted-syntax
  throw new Error("Expected value to be defined and non null");
};

export const fail = <T extends object = object>(
  key: ErrorKey,
  message?: string,
  data?: T,
): Err<ErrorObject<T>> => err(createError(key, message, data));

export type AmbiguousError = Result<unknown> | ErrorObject | Error | unknown;

export function normalizeError(error: ErrorObject): ErrorObject;
export function normalizeError(error: Error): ErrorObject;
export function normalizeError(error: Result<unknown>): ErrorObject;
export function normalizeError(error: unknown): ErrorObject;
export function normalizeError(error: AmbiguousError): ErrorObject {
  if (isErrorObject(error)) return error;

  if (typeof error === "object" && error !== null && "error" in error) {
    const errResult = error as Err<ErrorObject>;
    if (isErrorObject(errResult.error)) return errResult.error;
  }

  if (error instanceof Error) return errorToObject(error);

  return errorToObject(error);
}

export function wrapError<T extends object = object>(
  error: AmbiguousError,
  message: string,
  data?: T,
): Err<ErrorObject<T>>;
export function wrapError<T extends object = object>(
  error: AmbiguousError,
  key: ErrorKey,
  message: string,
  data?: T,
): Err<ErrorObject<T>>;
export function wrapError<T extends object = object>(
  error: AmbiguousError,
  keyOrMessage: ErrorKey | string,
  messageOrData?: string | T,
  data?: T,
): Err<ErrorObject<T>> {
  const normalizedError = normalizeError(error);

  const isKeyProvided = typeof messageOrData === "string";
  const newKey = isKeyProvided ? keyOrMessage : normalizedError.key;
  const message = isKeyProvided ? (messageOrData as string) : keyOrMessage;
  const mergedData = isKeyProvided ? data : (messageOrData as T | undefined);

  const wrappedMessage = normalizedError.message
    ? `${message}: ${normalizedError.message}`
    : message;

  return fail(newKey, wrappedMessage, {
    ...normalizedError.data,
    ...mergedData,
  } as T);
}

export const notImplementedError = (method: string) =>
  fail("not-implemented", `Method ${method} is not implemented`, { method });
