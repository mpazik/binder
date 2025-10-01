export type Callback<T> = (value: T) => void;
export type AsyncCallback<T> = (value: T) => Promise<void>;
export type Predicate<T> = (value: T) => boolean;
export type AsyncPredicate<T> = (value: T) => Promise<boolean>;

/**
 * A comparator function that returns a number indicating the relationship between two values
 * The number is negative if a is less than b, positive if a is greater than b, and zero if a is equal to b
 */
export type Comparator<T> = (a: T, b: T) => number;
