import { isOk, type Ok, type Result } from "./result.ts";

export function assertFailed(message: string): never {
  // eslint-disable-next-line no-restricted-syntax
  throw new Error(message);
}

export function assert(
  condition: unknown,
  name?: string,
  error?: string,
): void {
  if (condition) return;
  assertFailed(
    `Assertion failed${name ? ` for ${name}` : ""}${error ? `: ${error}` : ""}`,
  );
}

export function assertEqual<T>(
  first: T,
  second: T,
  name?: string,
): asserts first is T {
  if (first === second) return;
  assertFailed(
    name
      ? `${name} assertion failed: ${JSON.stringify(first)} !== ${JSON.stringify(second)}`
      : `Equality assertion failed: ${JSON.stringify(first)} !== ${JSON.stringify(second)}`,
  );
}

export function assertDefined<T>(
  value: T,
  name?: string,
): asserts value is NonNullable<T> {
  if (value !== undefined && value !== null) return;
  assertFailed(`${name ?? "value"} is ${value} but expected to be defined`);
}

export function assertUndefined<T>(
  value: T,
  name?: string,
): asserts value is NonNullable<T> {
  if (value === undefined || value === null) return;
  assertFailed(`${name ?? "value"} is ${value} but expected to be undefined`);
}

export function assertDefinedPass<T>(
  value: T | undefined | null,
  name?: string,
): T {
  assertDefined(value, name);
  return value;
}

export function assertType<S, T extends S>(
  value: S,
  check: (it: S) => it is T,
  name?: string,
): asserts value is T {
  if (check(value)) return;
  assertFailed(
    name
      ? `${name} has invalid type: ${JSON.stringify(value)}`
      : `Type assertion failed${value ? `: ${JSON.stringify(value)}` : ""}`,
  );
}

export function assertIsArray<T>(
  value: unknown,
  name: string = "value",
): asserts value is T[] {
  if (Array.isArray(value)) return;
  assertFailed(`${name} is not an array: ${JSON.stringify(value)}`);
}

export function assertNotEmpty<T>(
  array: T[],
  name?: string,
): asserts array is [T, ...T[]] {
  if (array.length > 0) return;
  assertFailed(name ? `${name} is empty` : "Array is empty");
}

export function assertNonBlank(
  value: string,
  name?: string,
): asserts value is string {
  if (value.trim()) return;
  assertFailed(
    name
      ? `${name} is blank: ${JSON.stringify(value)}`
      : `String is blank: ${JSON.stringify(value)}`, // stringify to encode blank characters
  );
}

export function assertOneOf<T>(
  value: unknown,
  allowed: readonly T[],
  name?: string,
): asserts value is T {
  if (allowed.includes(value as T)) return;
  assertFailed(
    name
      ? `${name} must be one of ${JSON.stringify(allowed)}, got ${JSON.stringify(value)}`
      : `Value not in allowed set: ${JSON.stringify(value)} not in ${JSON.stringify(allowed)}`,
  );
}

export function assertInRange(
  value: number,
  min: number | undefined,
  max?: number | undefined,
  name?: string,
): asserts value is number {
  if (
    (min === undefined || value >= min) &&
    (max === undefined || value <= max)
  )
    return;
  assertFailed(
    name
      ? `${name} is ${value}, expected to be in range [${min}, ${max}]`
      : `Value out of range: ${value} not in [${min}, ${max}]`,
  );
}

export function assertOk<T, E>(
  result: Result<T, E>,
  name?: string,
): asserts result is Ok<T> {
  if (isOk(result)) return;
  assertFailed(
    name
      ? `${name} failed with error: ${JSON.stringify(result.error)}`
      : `Result is Err: ${JSON.stringify(result.error)}`,
  );
}

export function assertGreaterThan(
  value: number,
  threshold: number,
  name?: string,
): asserts value is number {
  if (value > threshold) return;
  assertFailed(
    name
      ? `${name} is ${value}, expected to be greater than ${threshold}`
      : `Value ${value} is not greater than ${threshold}`,
  );
}

export function assertSmallerThan(
  value: number,
  threshold: number,
  name?: string,
): asserts value is number {
  if (value < threshold) return;
  assertFailed(
    name
      ? `${name} is ${value}, expected to be smaller than ${threshold}`
      : `Value ${value} is not smaller than ${threshold}`,
  );
}

export const assertCheck = assert;
