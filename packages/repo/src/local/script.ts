import { isErrorObject } from "@binder/utils";

/**
 * Print a message to stderr and exit the process with a non-zero code.
 *
 * Convenience for workspace scripts that bail on the first error, keeping
 * error handling to a single line:
 *
 * ```ts
 * const result = await open();
 * if (isErr(result)) fatalError("Failed to open workspace", result.error);
 * ```
 *
 * When `cause` is an `Error` or an `ErrorObject`, its message is appended.
 * Returns `never`, so the caller's value is narrowed past the guard.
 */
export const fatalError = (message: string, cause?: unknown): never => {
  const detail =
    cause instanceof Error
      ? cause.message
      : isErrorObject(cause)
        ? cause.message
        : cause !== undefined
          ? String(cause)
          : undefined;
  console.error(detail ? `${message}: ${detail}` : message);
  process.exit(1);
};
