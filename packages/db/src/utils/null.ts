type NullToUndefined<T> = {
  [K in keyof T]: T[K] extends null
    ? undefined
    : T[K] extends (infer U)[]
      ? NullToUndefined<U>[]
      : Exclude<T[K], null> | ([null] extends [T[K]] ? undefined : never);
};

export const nullsToUndefined = <T extends Record<string, unknown> | unknown[]>(
  obj: T,
): NullToUndefined<T> => {
  const result = Array.isArray(obj) ? ([...obj] as any) : { ...obj };

  Object.entries(result).forEach(([key, value]) => {
    if (value === null) {
      result[key] = undefined;
    } else if (typeof value === "object" && !(value instanceof Date)) {
      result[key] = nullsToUndefined(value as Record<string, unknown>);
    }
  });

  return result;
};
