/**
 * Creates a branded type - a type that is nominally different from its base type
 * Useful for type-safety when dealing with IDs, timestamps etc that share the same base type
 */
export type Brand<K, T> = K & { __brand: T };

/**
 * Extends a branded type with an additional brand marker.
 *
 * @template T - The base branded type to extend.
 * @template K - The additional brand marker to add.
 *
 * This type is useful when deriving a more specific type from an existing branded type.
 * For example, if you have a `UserID` branded type, you could create a more specific
 * branded type like `AdminUserID` by using this utility.
 */
export type BrandDerived<T extends Brand<any, any>, K extends string> = T & {
  __brand2: K;
};

export type OptionalProp<T, K extends keyof T> = Omit<T, K> &
  Partial<Pick<T, K>>;
