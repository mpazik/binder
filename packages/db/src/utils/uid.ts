import type { Brand } from "@binder/utils";
import {
  assertGreaterThan,
  assertInRange,
  binaryToBase64Uri,
  isBase64UriString,
} from "@binder/utils";

/**
 * A unique identifier (UID) if format {prefix}_{random base64url encoded}
 */
export type Uid = Brand<string, "Uid">;

const DEFAULT_UID_LENGTH = 8;
// 4 bytes = 6 chars (2^32, ~4B IDs, 1% collision at ~9K IDs)
// 6 bytes = 8 chars (2^48, ~281T IDs, 1% collision at ~19M IDs)
// 8 bytes = 11 chars (2^64, ~18 quintillion IDs, 1% collision at ~5B IDs)
export type ByteLength = 4 | 6 | 8;

const generateRandomBase64Uri = (byteLength: number): string => {
  const buf = new Uint8Array(byteLength);
  crypto.getRandomValues(buf);
  return binaryToBase64Uri(buf);
};

/**
 * Create a UID with the given prefix and length
 * @param length - The length of the UID random part in bytes
 * @param prefix - The prefix for the UID
 * @returns The UID
 */
export const createUid = <T extends Uid = Uid>(
  length: ByteLength = DEFAULT_UID_LENGTH,
  prefix?: string,
): T => {
  assertGreaterThan(length, 3, "length of uuid");
  if (prefix === undefined) {
    return generateRandomBase64Uri(length) as T;
  }

  assertInRange(prefix.length, 1, 5, "length of prefix");
  if (!/^[a-zA-Z]+$/.test(prefix)) {
    // eslint-disable-next-line no-restricted-syntax
    throw new Error("Prefix must contain only letters");
  }

  const randomPart = generateRandomBase64Uri(length);
  return `${prefix}_${randomPart}` as T;
};

const byteLengthToCharLength = (byteLength: ByteLength): number => {
  if (byteLength === 4) return 6;
  if (byteLength === 6) return 8;
  return 11;
};

export const isValidUid = (
  value: unknown,
  prefix?: string,
  length: ByteLength = DEFAULT_UID_LENGTH,
): value is Uid => {
  if (typeof value !== "string") return false;

  if (prefix !== undefined) {
    const fullPrefix = `${prefix}_`;
    if (!value.startsWith(fullPrefix)) return false;
    const randomPart = value.replace(fullPrefix, "");
    if (
      length !== undefined &&
      randomPart.length !== byteLengthToCharLength(length)
    )
      return false;
    return isBase64UriString(randomPart);
  }

  if (length !== undefined && value.length !== byteLengthToCharLength(length))
    return false;
  return isBase64UriString(value);
};
