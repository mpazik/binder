import { expect } from "bun:test";
import { binaryEqual } from "../encoding.ts";

declare module "bun:test" {
  // noinspection JSUnusedGlobalSymbols
  interface Matchers<T> {
    toEqualBuffer(expected: Uint8Array | ArrayBufferLike): T;
  }
  // noinspection JSUnusedGlobalSymbols
  interface AsymmetricMatchersContaining {
    toEqualBuffer(expected: Uint8Array | ArrayBufferLike): any;
  }
}

interface MatcherContext {
  equals: (a: unknown, b: unknown) => boolean;
}

expect.extend({
  toEqualBuffer(
    this: MatcherContext,
    received: unknown,
    expected: Uint8Array | ArrayBufferLike,
  ) {
    if (received == null) {
      return {
        pass: false,
        message: () =>
          `Expected received value to be defined, but got ${received}`,
      };
    }

    const receivedUint8 =
      received instanceof Uint8Array
        ? received
        : new Uint8Array(received as ArrayBufferLike);

    const expectedUint8 =
      expected instanceof ArrayBuffer || expected instanceof SharedArrayBuffer
        ? new Uint8Array(expected)
        : expected;
    const pass = binaryEqual(receivedUint8, expectedUint8);

    return {
      pass,
      message: () =>
        pass
          ? `Expected ${JSON.stringify(Array.from(receivedUint8))} not to equal ${JSON.stringify(Array.from(expectedUint8))}`
          : `Expected ${JSON.stringify(Array.from(receivedUint8))} to equal ${JSON.stringify(Array.from(expectedUint8))}`,
    };
  },
});

export {};
