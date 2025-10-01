import { expect } from "bun:test";
import { type ErrorObject, isErr, type Result } from "../index";

declare module "bun:test" {
  // noinspection JSUnusedGlobalSymbols
  interface Matchers<T> {
    toBeOk(): T;
    toBeOkWith(expected: unknown): T;
    toBeErr(): T;
    toBeErrWithKey(errorKey: string): T;
    toBeErrWithMessage(message: string): T;
  }
  // noinspection JSUnusedGlobalSymbols
  interface AsymmetricMatchersContaining {
    toBeOk(): any;
    toBeOkWith(expected: unknown): any;
    toBeErr(): any;
    toBeErrWithKey(errorKey: string): any;
    toBeErrWithMessage(message: string): any;
  }
}

interface MatcherContext {
  equals: (a: unknown, b: unknown) => boolean;
}

expect.extend({
  toBeOk(received: unknown) {
    const result = received as Result<unknown, unknown>;
    if (isErr(result))
      return {
        pass: false,
        message: () =>
          `Expected result to be successful, but it was an error: ${JSON.stringify(
            isErr(result) ? result.error : null,
          )}`,
      };

    return {
      pass: true,
      message: () => `Expected result to be an error, but it was successful`,
    };
  },

  toBeOkWith(this: MatcherContext, received: unknown, expected: unknown) {
    const result = received as Result<unknown, unknown>;
    if (isErr(result)) {
      return {
        pass: false,
        message: () =>
          `Expected result to be successful with data ${JSON.stringify(
            expected,
          )}, but it was an error: ${JSON.stringify(result.error)}`,
      };
    }

    const pass = this.equals(result.data, expected);

    return {
      pass,
      message: () =>
        pass
          ? `Expected result data not to equal ${JSON.stringify(expected)}`
          : `Expected result data to equal ${JSON.stringify(
              expected,
            )}, but received ${JSON.stringify(result.data)}`,
    };
  },

  toBeErr(received: unknown) {
    const result = received as Result<unknown, unknown>;
    const pass = isErr(result);

    return {
      pass,
      message: () =>
        pass
          ? `Expected result to be successful, but it was an error`
          : `Expected result to be an error, but it was successful with data: ${JSON.stringify(
              !isErr(result) ? result.data : null,
            )}`,
    };
  },

  toBeErrWithKey(received: unknown, errorKey: string) {
    const result = received as Result<unknown, unknown>;
    if (!isErr(result)) {
      return {
        pass: false,
        message: () =>
          `Expected result to be an error with key "${errorKey}", but it was successful with data: ${JSON.stringify(
            result.data,
          )}`,
      };
    }

    const pass = (result.error as ErrorObject).key === errorKey;

    return {
      pass,
      message: () =>
        pass
          ? `Expected result not to have error key "${errorKey}"`
          : `Expected result to have error key "${errorKey}", but got "${(result.error as ErrorObject).key}"`,
    };
  },

  toBeErrWithMessage(received: unknown, message: string) {
    const result = received as Result<unknown, unknown>;
    if (!isErr(result)) {
      return {
        pass: false,
        message: () =>
          `Expected result to be an error with message "${message}", but it was successful with data: ${JSON.stringify(
            result.data,
          )}`,
      };
    }

    const pass = (result.error as ErrorObject).message === message;

    return {
      pass,
      message: () =>
        pass
          ? `Expected result not to have error message "${message}"`
          : `Expected result to have error message "${message}", but got "${(result.error as ErrorObject).message}"`,
    };
  },
});

export {};
