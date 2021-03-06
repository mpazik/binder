import { LinkedData, LinkedDataWithHashId } from "./jsonld-format";
import { normalizeLinkedData } from "./linked-data";
import { Opaque } from "./types";

type Hash = ArrayBuffer;
type HashingAlgorithm = "sha-1" | "sha-256" | "sha-384" | "sha-512";
type HashReference = [Hash, HashingAlgorithm];

export const hashUriScheme = "nih"; // named information hex format https://tools.ietf.org/html/rfc6920

export type HashUri = Opaque<string>;
export type HashName = Opaque<string>;

export const isHashUri = (uri: string): uri is HashUri =>
  uri.startsWith(hashUriScheme);

export const isHashName = (uri: string): uri is HashName =>
  uri.startsWith("sha-256_");

export const hashUriToHashName = (hash: HashUri): HashName =>
  hash.slice(4).replace(";", "_") as HashName;

export const hashNameToHashUri = (name: HashName): HashUri =>
  `${hashUriScheme}:${name.replace("_", ";")}` as HashUri;

const byteToHex: string[] = [...Array(0xff).keys()].map((n) =>
  n.toString(16).padStart(2, "0")
);

const bufferToHex = (arrayBuffer: ArrayBuffer) => {
  const buff = new Uint8Array(arrayBuffer);
  const hexOctets = [];
  for (let i = 0; i < buff.length; ++i) hexOctets.push(byteToHex[buff[i]]);
  return hexOctets.join("");
};

const referenceToHashUri = (ref: HashReference): HashUri =>
  `${hashUriScheme}:${ref[1]};${bufferToHex(ref[0])}` as HashUri;

export const computeHash = (
  buffer: ArrayBuffer,
  algorithm: HashingAlgorithm = "sha-256"
): Promise<HashReference> =>
  crypto.subtle.digest(algorithm, buffer).then((hash) => [hash, algorithm]);

export const hashBlob = async (
  data: Blob,
  algorithm: HashingAlgorithm = "sha-256"
): Promise<HashUri> => {
  const buffer = await data.arrayBuffer();
  return referenceToHashUri(await computeHash(buffer, algorithm));
};

export const hashLinkedData = async (
  data: LinkedData,
  algorithm: HashingAlgorithm = "sha-256"
): Promise<HashUri> => {
  const { "@id": id, ...rest } = data;
  console.log(rest);
  const normalized = await normalizeLinkedData(rest);
  return referenceToHashUri(await computeHash(normalized, algorithm));
};

export const computeLinkedDataWithHashId = async (
  data: LinkedData,
  algorithm: HashingAlgorithm = "sha-256"
): Promise<LinkedDataWithHashId> => {
  // copy linked data to not modify passed property
  const { ...linkedDataToHash } = data;
  const oldId = linkedDataToHash["@id"];
  if (oldId && !oldId.startsWith(hashUriScheme)) {
    throw new Error(
      "Linked data already have hash uri Id, saving operation would remove it"
    );
  }
  delete linkedDataToHash["@id"]; // remove id as we would replace it
  const hashUri = await hashLinkedData(linkedDataToHash, algorithm);
  if (oldId && oldId !== hashUri) {
    throw new Error(`Filed ${oldId} is corrupted`);
  }
  linkedDataToHash["@id"] = hashUri;
  return linkedDataToHash as LinkedDataWithHashId;
};
