import {
  type ErrorObject,
  isErrorObject,
  reportErrorObject,
  serializeErrorData,
} from "./error.ts";

export type Ok<T> = {
  readonly data: T;
  readonly error?: undefined;
};
export type Err<E> = {
  readonly error: E;
  readonly data?: undefined;
};
export type Result<T, E = ErrorObject> = Ok<T> | Err<E>;

export const ok = <T>(data: T): Ok<T> => ({ data });
export const err = <E>(error: E): Err<E> => ({ error });
export const okVoid: Ok<void> = ok(undefined);

export const isOk = <T, E>(result: Result<T, E>): result is Ok<T> => {
  return "data" in result;
};
export const isErr = <T, E>(result: Result<T, E>): result is Err<E> => {
  return "error" in result;
};

export type ResultAsync<T, E = ErrorObject> = Promise<Result<T, E>>;

export function tryCatch<T, E = ErrorObject>(
  promise: Promise<T>,
  mapError?: (err: unknown) => E,
): ResultAsync<T, E>;
export function tryCatch<T, E = ErrorObject>(
  fn: () => Promise<T>,
  mapError?: (err: unknown) => E,
): ResultAsync<T, E>;
export function tryCatch<T, E = ErrorObject>(
  fn: () => T,
  mapError?: (err: unknown) => E,
): Result<T, E>;
export function tryCatch<T, E = ErrorObject>(
  fnOrPromise: Promise<T> | (() => T) | (() => Promise<T>),
  mapError?: (err: unknown) => E,
): Result<T, E> | ResultAsync<T, E> {
  if (fnOrPromise instanceof Promise) {
    return fnOrPromise
      .then(ok)
      .catch((error) =>
        err(mapError ? mapError(error) : (serializeErrorData(error) as E)),
      );
  }

  // eslint-disable-next-line no-restricted-syntax
  try {
    const result = fnOrPromise();
    return result instanceof Promise
      ? result
          .then(ok)
          .catch((error) =>
            err(mapError ? mapError(error) : (serializeErrorData(error) as E)),
          )
      : ok(result);
  } catch (error) {
    return err(mapError ? mapError(error) : (serializeErrorData(error) as E));
  }
}

export const mapResult = <T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U,
): Result<U, E> => {
  return isOk(result) ? ok(fn(result.data)) : result;
};

export const mapResultAsync = async <T, U, E>(
  result: ResultAsync<T, E>,
  fn: (value: T) => U | ResultAsync<U, E>,
): ResultAsync<U, E> => {
  const resultAwaited = await result;
  if (isErr(resultAwaited)) return resultAwaited;
  const mappedResult = fn(resultAwaited.data);
  if (mappedResult instanceof Promise) return mappedResult;
  return ok(mappedResult);
};

export const allValid = <T, E>(results: Result<T, E>[]): Result<T[], E> => {
  const correct: T[] = new Array(results.length);
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (isErr(result)) return result as Result<T[], E>;
    correct[i] = result.data;
  }
  return ok(correct);
};

export const resultFallback = <T, E>(
  result: Result<T, E>,
  fallbackValue: T,
): T => {
  return isOk(result) ? result.data : fallbackValue;
};

export const throwIfError = <T, E>(result: Result<T, E>): T => {
  if (isErr(result)) {
    if (isErrorObject(result.error)) {
      reportErrorObject(result.error);
    } else {
      console.error(result.error);
    }
    // eslint-disable-next-line no-restricted-syntax
    throw result.error instanceof Error
      ? result.error
      : new Error(JSON.stringify(result.error));
  }
  return result.data;
};

export const throwIfValue = <T, E>(result: Result<T, E>): E => {
  // eslint-disable-next-line no-restricted-syntax
  if (isOk(result)) throw result.data;
  return result.error;
};
