export const groupBy = <T, K extends string>(
  array: T[],
  key: (item: T) => K,
): Record<K, T[]> => {
  return array.reduce(
    (acc, item) => {
      const k = key(item);
      acc[k] = acc[k] || [];
      acc[k].push(item);
      return acc;
    },
    {} as Record<string, T[]>,
  );
};

export const groupByToObject = <T, K extends string>(
  array: T[],
  key: (item: T) => K,
): Record<K, T> => {
  return Object.fromEntries(array.map((item) => [key(item), item])) as Record<
    K,
    T
  >;
};

export const transformEntries = <K extends string, V, K2 extends string, V2>(
  obj: Record<K, V>,
  transform: (entries: [K, V][]) => [K2, V2][],
): Record<K2, V2> =>
  Object.fromEntries(transform(Object.entries(obj) as [K, V][])) as Record<
    K2,
    V2
  >;

export const mapObjectValues = <T, S, K extends string>(
  obj: Record<K, T>,
  fn: (value: T, key: K) => S,
): Record<K, S> =>
  transformEntries(obj, (entries) =>
    entries.map(([key, value]) => [key, fn(value, key)]),
  );

export const filterObjectValues = <T, O extends Record<string, T>>(
  obj: Record<string, T>,
  fn: (value: T, key: keyof O) => boolean,
): O =>
  transformEntries(obj, (entries) =>
    entries.filter(([key, value]) => fn(value, key)),
  ) as O;

export const objectFromKeys = <T>(keys: string[], fn: (key: string) => T) => {
  return Object.fromEntries(keys.map((key) => [key, fn(key)]));
};

export const pick = <T extends Record<string, any>, K extends keyof T>(
  obj: T,
  keys: K[],
): Pick<T, K> => {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (key in obj) {
      result[key] = obj[key];
    }
  }
  return result;
};

export const omit = <T extends Record<string, any>, K extends keyof T>(
  obj: T,
  keys: readonly K[],
): Omit<T, K> => {
  const result = {} as Omit<T, K>;
  for (const key of Object.keys(obj)) {
    if (!keys.includes(key as K)) {
      // @ts-ignore
      result[key] = obj[key];
    }
  }
  return result;
};

export const removeNullish = <T extends Record<string, unknown>>(
  obj: T,
): { [K in keyof T]: NonNullable<T[K]> } => {
  const result = {} as any;
  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && value !== undefined) {
      result[key] = value;
    }
  }
  return result;
};

export const redactFromObject = <T extends Record<string, any>>(
  obj: T,
  paths: string[],
): T => {
  const result = JSON.parse(JSON.stringify(obj));

  for (const path of paths) {
    const keys = path.split(".");
    if (keys.length === 0) {
      break;
    }

    let current = result;

    for (const key of keys) {
      if (current && typeof current === "object") {
        current = current[key];
      } else {
        break;
      }
    }

    const lastKey = keys[keys.length - 1]!;
    if (current && typeof current === "object") {
      delete current[lastKey];
    }
  }

  return result;
};

export const objKeys = <K extends string>(obj: Record<K, unknown>): K[] =>
  Object.keys(obj) as K[];

export const objEntries = <K extends string, V>(obj: Record<K, V>): [K, V][] =>
  Object.entries(obj) as [K, V][];

// ObjTuple: Single-key object representing a key-value pair { [key]: value }
// Used for external APIs where YAML ergonomics matter
// Example: { "user-2": { role: "lead" } } represents ["user-2", { role: "lead" }]

export type ObjTuple<K extends string = string, V = unknown> = {
  [key in K]: V;
};

export const isObjTuple = <V = unknown>(
  item: unknown,
): item is ObjTuple<string, V> =>
  typeof item === "object" &&
  item !== null &&
  !Array.isArray(item) &&
  Object.keys(item).length === 1;

export const objTupleKey = <K extends string>(obj: ObjTuple<K, unknown>): K =>
  Object.keys(obj)[0] as K;

export const objTupleValue = <V>(obj: ObjTuple<string, V>): V =>
  Object.values(obj)[0] as V;

export const objTupleToTuple = <K extends string, V>(
  obj: ObjTuple<K, V>,
): [K, V] => {
  const key = Object.keys(obj)[0] as K;
  return [key, obj[key]];
};

export const tupleToObjTuple = <K extends string, V>(
  tuple: [K, V],
): ObjTuple<K, V> => ({ [tuple[0]]: tuple[1] }) as ObjTuple<K, V>;

export const isEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (a && b && typeof a == "object" && typeof b == "object") {
    if (a.constructor !== b.constructor) {
      if (
        a.constructor.name !== "Uint8Array" ||
        b.constructor.name !== "Uint8Array"
      ) {
        return false;
      }
    }
    let length, i;
    if (Array.isArray(a)) {
      if (!Array.isArray(b)) return false;
      length = a.length;
      if (length != b.length) return false;
      for (i = length; i-- !== 0; ) if (!isEqual(a[i], b[i])) return false;
      return true;
    }
    const keys = Object.keys(a);
    length = keys.length;
    if (length !== Object.keys(b).length) return false;
    for (i = length; i-- !== 0; )
      if (!Object.prototype.hasOwnProperty.call(b, keys[i])) return false;
    for (i = length; i-- !== 0; ) {
      const key = keys[i];

      if (!isEqual((a as any)[key], (b as any)[key])) return false;
    }
    return true;
  }
  // true if both NaN, false otherwise
  return a !== a && b !== b;
};
