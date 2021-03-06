import { normalize, Options } from "jsonld";
import { JsonLd } from "jsonld/jsonld-spec";
import { URL } from "schema-dts";

import annotations from "../schema/anno.json";
import schemaorg from "../schema/schemaorg.json";

import { throwIfNull } from "./errors";
import { HashName, HashUri, isHashUri } from "./hash";
import { LinkedData, LinkedDataWithHashId } from "./jsonld-format";

const contexts = new Map<string, JsonLd>([
  ["http://www.w3.org/ns/anno.jsonld", annotations as JsonLd],
  ["https://schema.org", schemaorg as JsonLd],
]);

const contextLoader: Options.DocLoader["documentLoader"] = (url) => {
  const context = contexts.get(url);
  if (!context) {
    console.error(`Could not find context for ${url}`);
    return Promise.reject(`Could not find context for ${url}`);
  }
  return Promise.resolve({
    document: context,
    documentUrl: url,
  });
};

export const getHash = (ld: LinkedDataWithHashId): HashName => ld["@id"];

export const getType = (ld: LinkedData): string | undefined =>
  ld["@type"] ?? (ld["type"] as string);

export const isTypeEqualTo = (ld: LinkedData, type: string): boolean => {
  const ldType = getType(ld);
  if (!ldType) return false;
  return ldType.toLowerCase() === type;
};

export const getPropertyValue = <T = string>(
  ld: LinkedData,
  property: string
): T => {
  const propertyValues = getPropertyValues<T>(ld, property);
  return throwIfNull(propertyValues.length === 0 ? null : propertyValues[0]);
};

export const getPropertyValues = <T>(ld: LinkedData, property: string): T[] => {
  const value = (ld[property] as unknown) as T | T[] | undefined;
  return [value ?? []].flat() as T[];
};
export const getUrls = (ld: LinkedData): URL[] => getPropertyValues(ld, "url");

export const findUrl = (ld: LinkedData): URL | undefined =>
  getUrls(ld).find((it) => !isHashUri(it));

export const findHashUri = (ld: LinkedData): HashUri | undefined =>
  getUrls(ld).find((it) => isHashUri(it)) as HashUri;

const textEncoder = new TextEncoder();
export const normalizeLinkedData = (data: LinkedData): Promise<ArrayBuffer> =>
  normalize(data, {
    documentLoader: contextLoader,
    algorithm: "URDNA2015",
  })
    .then((it) => {
      console.log("normalizes", it);
      return it;
    })
    .then((normalized) => textEncoder.encode(normalized).buffer);
