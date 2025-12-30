import type { IsoDate, IsoTimestamp } from "@binder/utils";
import type { EntityId, EntityKey, EntityUid } from "./entity.ts";
import type { Filters, QueryParams } from "./query.ts";

export type DataTypeDef = {
  name: string;
  description?: string;
};
export type DataTypeDefs = Record<string, DataTypeDef>;

export type AlphabetDef = DataTypeDef & {
  pattern?: RegExp;
  errorMessage?: string;
};
export type AlphabetDefs = Record<string, AlphabetDef>;
export const coreDataTypes = {
  seqId: { name: "Sequential Id" },
  uid: { name: "Uid" },
  relation: { name: "Relation" },
  boolean: { name: "Boolean" },
  integer: { name: "Integer" },
  decimal: { name: "Decimal" },
  plaintext: { name: "Plaintext" },
  richtext: {
    name: "Richtext",
    description: "Text with structure and styling",
  },
  date: { name: "Date" },
  datetime: { name: "Date Time" },
  // formula: { name: "Formula" },
  // condition: { name: "Condition" },
  // query: { name: "Query" },
} as const satisfies DataTypeDefs;

export const plaintextAlphabets = {
  token: {
    name: "Token",
    description: "Contains only letters and digits (e.g., abc123)",
    pattern: /^[A-Za-z0-9]*$/,
    errorMessage: "Value must contain only letters and digits",
  },
  code: {
    name: "Code",
    description:
      "Programmatic code starting with a letter, containing letters, digits, hyphens, and underscores (e.g., my-item_v2)",
    pattern: /^[A-Za-z][A-Za-z0-9_-]*$/,
    errorMessage:
      "Value must start with a letter and contain only letters, digits, hyphens, and underscores",
  },
  word: {
    name: "Word",
    description: "Single word without any whitespace characters",
    pattern: /^\S*$/,
    errorMessage: "Value must be a single word without whitespace",
  },
  line: {
    name: "Line",
    description:
      "Single line of text that may contain spaces but no line breaks",
    pattern: /^[^\n]*$/,
    errorMessage: "Value must be a single line without line breaks",
  },
  paragraph: {
    name: "Paragraph",
    description:
      "Multiple lines of text without blank lines. Multiple values are separated by blank lines.",
    pattern: /^(?!.*\n\n).*$/s,
    errorMessage: "Value must not contain blank lines",
  },
} as const satisfies AlphabetDefs;

export const richtextAlphabets = {
  word: {
    name: "Word",
    description: "Single styled word without spaces",
    pattern: /^\S*$/,
    errorMessage: "Value must be a single word without whitespace",
  },
  line: {
    name: "Line",
    description:
      "Single line that may contain inline formatting but no line breaks",
    pattern: /^[^\n]*$/,
    errorMessage: "Value must be a single line without line breaks",
  },
  block: {
    name: "Block",
    description:
      "Single content block such as a paragraph, list, or code block without blank lines",
    pattern: /^(?!.*\n\n).*$/s,
    errorMessage: "Value must not contain blank lines",
  },
  section: {
    name: "Section",
    description:
      "Full document section that may contain any content including headings, lists, and multiple blocks. Multiple values are separated by horizontal rules.",
    pattern: /^(?!.*-{3,}).*$/s,
    errorMessage: "Value must not contain horizontal rules (---)",
  },
} as const satisfies AlphabetDefs;

export type PlaintextAlphabet = keyof typeof plaintextAlphabets;
export type RichtextAlphabet = keyof typeof richtextAlphabets;

export const dataTypeDefsToOptions = (
  dataTypeDefs: DataTypeDefs,
): OptionDef[] => {
  return Object.entries(dataTypeDefs).map(([key, value]) => ({
    key,
    name: value.name,
    description: value.description,
  }));
};
export type OptionDef = {
  key: string;
  name?: string;
  description?: string;
};
export type CoreDataType = keyof typeof coreDataTypes;

export type DataTypeValueMap = {
  seqId: EntityId;
  uid: EntityUid;
  key: EntityKey;
  relation: EntityKey;
  boolean: boolean;
  integer: number;
  decimal: number;
  plaintext: string;
  richtext: string;
  date: IsoDate;
  datetime: IsoTimestamp;
  interval: string;
  duration: string;
  option: string;
  uri: string;
  object: object;
  formula: object;
  condition: Filters;
  query: QueryParams;
  optionSet: OptionDef[];
};

export const plaintextAlphabetOptions =
  dataTypeDefsToOptions(plaintextAlphabets);
export const richtextAlphabetOptions = dataTypeDefsToOptions(richtextAlphabets);

// This will cause a compilation error if any ConfigDataType is missing from DataTypeValueMap
const _validateDataTypeMapCompleteness: {
  [K in CoreDataType]: K extends keyof DataTypeValueMap ? true : false;
} = {} as {
  [K in CoreDataType]: true;
};
void _validateDataTypeMapCompleteness; // prevent unused variable warning

// Helper types to get the value type based on dataType, with support for allowMultiple
export type GetValueType<T> = T extends {
  dataType: infer D;
  allowMultiple: true;
}
  ? D extends keyof DataTypeValueMap
    ? DataTypeValueMap[D][]
    : unknown
  : T extends { dataType: infer D }
    ? D extends keyof DataTypeValueMap
      ? DataTypeValueMap[D]
      : unknown
    : unknown;
