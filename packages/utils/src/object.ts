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

export const mapObjectValues = <T, K>(
  obj: Record<string, T>,
  fn: (value: T, key: string) => K,
): Record<string, K> => {
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [key, fn(value, key)]),
  );
};

export const filterObjectValues = <T>(
  obj: Record<string, T>,
  fn: (value: T, key: string) => boolean,
): Record<string, T> => {
  return Object.fromEntries(
    Object.entries(obj).filter(([key, value]) => fn(value, key)),
  );
};

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
