import type { Brand } from "./type.ts";

export type Base64 = Brand<string, "Base64">;
export type Base64Uri = Brand<string, "Base64Uri">;
export type HexString = Brand<string, "HexString">;

export const binaryEqual = (
  a: Uint8Array | undefined,
  b: Uint8Array | undefined,
): boolean => {
  if (a === b) return true;
  if (a === undefined || b === undefined) return a === b;
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

export const base64ToBinary = (base64: Base64): Uint8Array => {
  const binary_string = atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes;
};

export const binaryToBase64 = (bytes: Uint8Array): Base64 => {
  // @ts-ignore
  return btoa(String.fromCharCode.apply(0, bytes));
};

export const base64ToBase64Uri = (base64: Base64): Base64Uri =>
  base64.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_") as Base64Uri;

export const uriBase64ToBase64 = (base64: Base64Uri): Base64 =>
  base64.replace(/-/g, "+").replace(/_/g, "/") as Base64;

export const hexToBinary = (hex: HexString): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
};

const DIGITS = "0123456789abcdef";

export const binaryToHex = (buff: ArrayBuffer): HexString => {
  const hexOctets = [];
  const bytes = new Uint8Array(buff);
  for (let i = 0; i < bytes.length; ++i)
    hexOctets.push(
      DIGITS.charAt(bytes[i] >>> 4) + DIGITS.charAt(bytes[i] & 0xf),
    );
  return hexOctets.join("") as HexString;
};
export const base64UriToBinary = (s: Base64Uri): BinaryString =>
  base64ToBinary(uriBase64ToBase64(s));

export const binaryToBase64Uri = (data: BinaryString): Base64Uri =>
  base64ToBase64Uri(binaryToBase64(data));

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export type BinaryString = Uint8Array;
export const stringToBinary = (str: string): BinaryString =>
  encoder.encode(str);
export const binaryToString = (data: BinaryString): string =>
  decoder.decode(data);

export type Json = string | number | boolean | object;
export const jsonToBinary = (json: Json): BinaryString =>
  stringToBinary(jsonToString(json));
export const jsonToString = (json: Json): string => JSON.stringify(json);

export const binaryToJson = (data: BinaryString): Json =>
  stringToJson(binaryToString(data));

export const stringToJson = <T extends Json = Json>(data: string): T =>
  JSON.parse(data);

export const isBase64UriString = (value: string): boolean =>
  /^[0-9A-Za-z_-]+$/.test(value);
