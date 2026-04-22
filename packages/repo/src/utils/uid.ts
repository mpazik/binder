import type { Brand } from "@binder/utils";
import {
  assertGreaterThan,
  assertInRange,
  binaryToBase64Uri,
  isBase64UriString,
} from "@binder/utils";

/**
 * A unique identifier (UID) in format:
 * - Without prefix: base64url string (e.g., "a1b2c3d4e5f" - 11 chars for default 8 bytes)
 * - With prefix: {prefix}_{random} (e.g., "typ_a1b2c3d4" - 12 chars total: 3 + 1 + 8)
 */
export type Uid = Brand<string, "Uid">;

const DEFAULT_UID_LENGTH = 8;
// 4 bytes = 6 chars random part (2^32, ~4B IDs, 1% collision at ~9K IDs)
// 6 bytes = 8 chars random part (2^48, ~281T IDs, 1% collision at ~19M IDs)
// 8 bytes = 11 chars random part (2^64, ~18 quintillion IDs, 1% collision at ~5B IDs)
export type ByteLength = 4 | 6 | 8;

const generateRandomBase64Uri = (
  byteLength: number,
  nonLetterStart: boolean,
): string => {
  const buf = new Uint8Array(byteLength);
  crypto.getRandomValues(buf);
  if (nonLetterStart) {
    // Constrain byte[0] so the first base64url character is a non-letter ([0-9_-]).
    // Base64url indices 52–63 map to non-letter chars. byte[0] >> 2 gives the index,
    // so byte[0] in 208–255 (48 values) maps uniformly to those 12 chars (4 each).
    buf[0] = 208 + (buf[0] % 48);
  }
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
    return generateRandomBase64Uri(length, true) as T;
  }

  assertInRange(prefix.length, 1, 5, "length of prefix");
  if (!/^[a-zA-Z]+$/.test(prefix)) {
    // eslint-disable-next-line no-restricted-syntax
    throw new Error("Prefix must contain only letters");
  }

  const randomPart = generateRandomBase64Uri(length, false);
  return `${prefix}_${randomPart}` as T;
};

const byteLengthToCharLength = (byteLength: ByteLength): number => {
  if (byteLength === 4) return 6;
  if (byteLength === 6) return 8;
  return 11;
};

/**
 * Validates UID format
 * @param value - The value to validate
 * @param prefix - When provided, validates "{prefix}_{random}" format. When omitted, validates entire value length.
 * @param length - Byte length of random part
 */
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
  // Non-prefixed UIDs must not start with a letter to avoid ambiguity with keys
  if (/^[A-Za-z]/.test(value)) return false;
  return isBase64UriString(value);
};
