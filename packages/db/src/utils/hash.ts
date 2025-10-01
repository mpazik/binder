import { binaryToHex, type Brand, type HexString } from "@binder/utils";

type HashBin = Brand<ArrayBuffer, "HashBin">;
type HashHex = Brand<HexString, "HashHex">;
type HashingAlgorithm = "sha-1" | "sha-256" | "sha-384" | "sha-512";
type HashReference = [HashBin, HashingAlgorithm];

export type Uri = Brand<string, "Uri">;
export type HashUri = Brand<Uri, "HashUri">;
export const hashUriScheme = "nih"; // named information hex format https://tools.ietf.org/html/rfc6920

export const isHashUri = (uri: string): uri is HashUri =>
  uri.startsWith(hashUriScheme);

export const hashToHex = (hash: HashBin): HashHex =>
  binaryToHex(hash) as HashHex;

export const referenceToHashUri = ([hash, alg]: HashReference): HashUri =>
  `${hashUriScheme}:${alg};${hashToHex(hash)}` as HashUri;

export type HashFunction<T> = (
  buffer: T,
  algorithm?: HashingAlgorithm,
) => Promise<HashBin>;

export const hashBytes: HashFunction<ArrayBuffer> = (
  buffer,
  algorithm = "sha-256",
): Promise<HashBin> =>
  crypto.subtle.digest(algorithm, buffer) as Promise<HashBin>;

export const hashString: HashFunction<string> = (
  string: string,
  algorithm = "sha-256",
): Promise<HashBin> => {
  const bytes = new TextEncoder().encode(string);
  return hashBytes(bytes.buffer as ArrayBuffer, algorithm);
};

export const hashToUri = async <T>(
  data: T,
  fn: HashFunction<T>,
  algorithm: HashingAlgorithm = "sha-256",
): Promise<HashUri> =>
  referenceToHashUri([await fn(data, algorithm), algorithm]);

export const hashBlob = async (
  data: Blob,
  algorithm: HashingAlgorithm = "sha-256",
): Promise<HashUri> => {
  const buffer = await data.arrayBuffer();
  return hashToUri(buffer, hashBytes, algorithm);
};
