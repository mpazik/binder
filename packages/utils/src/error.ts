import { err, type Err, type Result } from "./result.ts";

export type ErrorKey = string;

export type ErrorObject = {
  key: ErrorKey;
  message: string;
  cause?: ErrorObject;
  suggestion?: string;
  data?: object;
};

type ErrorOptions = {
  suggestion?: string;
  data?: object;
};

/**
 * Creates an ErrorObject.
 *
 * @param key - static error identifier in kebab-case, never interpolated with runtime values
 * @param message - human-readable description, may contain user values
 * @param options - optional suggestion and data
 */
export const createError = (
  key: ErrorKey,
  message: string,
  options?: ErrorOptions,
): ErrorObject => ({
  key,
  message,
  ...(options?.suggestion !== undefined && { suggestion: options.suggestion }),
  ...(options?.data !== undefined && { data: options.data }),
});

export const isErrorObject = (error: unknown): error is ErrorObject => {
  return (
    typeof error === "object" &&
    error !== null &&
    "key" in error &&
    typeof (error as ErrorObject).key === "string" &&
    "message" in error &&
    typeof (error as ErrorObject).message === "string"
  );
};

export const errorToObject = (error: unknown, name?: string): ErrorObject => {
  if (error instanceof Error) {
    return createError(name ?? error.name, error.message, {
      data: error.stack ? { stack: error.stack } : undefined,
    });
  }
  return createError(name ?? "unknown", String(error));
};

/**
 * Returns a failed Result containing an ErrorObject.
 *
 * @param key - static error identifier in kebab-case
 * @param message - human-readable description
 * @param options - optional suggestion and data
 */
export const fail = (
  key: ErrorKey,
  message: string,
  options?: ErrorOptions,
): Err<ErrorObject> => err(createError(key, message, options));

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

/**
 * Wraps an error with a new message, setting the original as `cause`.
 * Inherits the key from the original error.
 */
export function wrapError(
  error: AmbiguousError,
  message: string,
  options?: ErrorOptions,
): Err<ErrorObject>;
/**
 * Wraps an error with a new key and message, setting the original as `cause`.
 */
export function wrapError(
  error: AmbiguousError,
  key: ErrorKey,
  message: string,
  options?: ErrorOptions,
): Err<ErrorObject>;
export function wrapError(
  error: AmbiguousError,
  keyOrMessage: string,
  messageOrOptions?: string | ErrorOptions,
  options?: ErrorOptions,
): Err<ErrorObject> {
  const cause = normalizeError(error);

  const isKeyProvided = typeof messageOrOptions === "string";
  const key = isKeyProvided ? keyOrMessage : cause.key;
  const message = isKeyProvided ? messageOrOptions : keyOrMessage;
  const opts = isKeyProvided
    ? options
    : (messageOrOptions as ErrorOptions | undefined);

  return err({
    key,
    message,
    cause,
    ...(opts?.suggestion !== undefined && { suggestion: opts.suggestion }),
    ...(opts?.data !== undefined && { data: opts.data }),
  });
}

/**
 * Extracts the chain of error keys from a cause chain. Telemetry-safe.
 */
export const errorChain = (error: ErrorObject): string[] => {
  const keys: string[] = [];
  let current: ErrorObject | undefined = error;
  while (current) {
    keys.push(current.key);
    current = current.cause;
  }
  return keys;
};

/**
 * Formats an error for human-readable stderr output.
 * Walks the cause chain with indentation.
 */
export const formatError = (error: ErrorObject): string => {
  const lines: string[] = [];
  lines.push(`Error: ${error.message}`);
  if (error.suggestion) {
    lines.push(`  suggestion: ${error.suggestion}`);
  }
  let current = error.cause;
  while (current) {
    lines.push(`  cause: ${current.message}`);
    if (current.suggestion) {
      lines.push(`    suggestion: ${current.suggestion}`);
    }
    current = current.cause;
  }
  return lines.join("\n");
};

// Can not be just `reportError` as it would conflict with the global `reportError` function
export const reportErrorObject = (error: ErrorObject) => {
  console.error(formatError(error));
};

export const reportWarning = (message: string, data?: object) => {
  console.warn(message, JSON.stringify(data, null, 2));
};

export const reportErrorAsWarning = (error: ErrorObject) => {
  console.warn(`Ignoring error: ${formatError(error)}`);
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

export const notImplementedError = (method: string) =>
  fail("not-implemented", `Method ${method} is not implemented`, {
    data: { method },
  });
