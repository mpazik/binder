import { assertCheck } from "./assert.ts";

export const partition = <T>(
  array: T[],
  predicate: (item: T) => boolean,
): [T[], T[]] => {
  return [array.filter(predicate), array.filter((item) => !predicate(item))];
};

export const createPackedIdArray = <
  T,
  I extends number = number,
  R extends T[] = T[],
>(
  record: Record<I, T>,
): R => {
  const ids = Object.keys(record).map((it) => Number(it));
  for (let i = 0; i < ids.length; i++) {
    assertCheck(
      ids[i] === i,
      "packed id array",
      `Expected key id [${ids[i]}] to match the index [${i}]`,
    );
  }

  return Object.values(record) as R;
};

export const includes = <T extends readonly unknown[]>(
  arr: T,
  value: unknown,
): value is T[number] => arr.includes(value as T[number]);
