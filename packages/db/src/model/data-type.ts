import type { IsoDate, IsoTimestamp } from "@binder/utils";
import type { EntityId, EntityKey, EntityUid } from "./entity.ts";
import type { Filters, QueryParams } from "./query.ts";

export type DataTypeDef = {
  name: string;
  description?: string;
};
export type DataTypeDefs = Record<string, DataTypeDef>;

export type AlphabetValidatorContext = {
  allowMultiple?: boolean;
};

export type AlphabetValidator = (
  value: string,
  context: AlphabetValidatorContext,
) => string | undefined;

export type AlphabetDef = DataTypeDef & {
  validate: AlphabetValidator;
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
} as const satisfies DataTypeDefs;

const createPatternValidator =
  (pattern: RegExp, errorMessage: string): AlphabetValidator =>
  (value, _context) =>
    pattern.test(value) ? undefined : errorMessage;

export const plaintextAlphabets = {
  token: {
    name: "Token",
    description: "Contains only letters and digits (e.g., abc123)",
    validate: createPatternValidator(
      /^[A-Za-z0-9]*$/,
      "Value must contain only letters and digits",
    ),
  },
  code: {
    name: "Code",
    description:
      "Programmatic code starting with a letter, containing letters, digits, hyphens, and underscores (e.g., my-item_v2)",
    validate: createPatternValidator(
      /^[A-Za-z][A-Za-z0-9_-]*$/,
      "Value must start with a letter and contain only letters, digits, hyphens, and underscores",
    ),
  },
  word: {
    name: "Word",
    description: "Single word without any whitespace characters",
    validate: createPatternValidator(
      /^\S*$/,
      "Value must be a single word without whitespace",
    ),
  },
  line: {
    name: "Line",
    description:
      "Single line of text that may contain spaces but no line breaks",
    validate: createPatternValidator(
      /^[^\n]*$/,
      "Value must be a single line without line breaks",
    ),
  },
  paragraph: {
    name: "Paragraph",
    description:
      "Multiple lines of text without blank lines. Multiple values are separated by blank lines.",
    validate: createPatternValidator(
      /^(?!.*\n\n).*$/s,
      "Value must not contain blank lines",
    ),
  },
} as const satisfies AlphabetDefs;

const containsMarkdownHeader = (value: string): boolean =>
  /^#{1,6}\s/m.test(value);

const containsHorizontalRule = (value: string): boolean =>
  /^-{3,}\s*$/m.test(value);

export const richtextAlphabets = {
  word: {
    name: "Word",
    description: "Single styled word without spaces",
    validate: createPatternValidator(
      /^\S*$/,
      "Value must be a single word without whitespace",
    ),
  },
  line: {
    name: "Line",
    description:
      "Single line that may contain inline formatting but no line breaks",
    validate: createPatternValidator(
      /^[^\n]*$/,
      "Value must be a single line without line breaks",
    ),
  },
  block: {
    name: "Block",
    description:
      "Single content block such as a paragraph, list, or code block. No headers or blank lines allowed.",
    validate: (value, _context) => {
      if (/\n\n/.test(value)) return "Value must not contain blank lines";
      if (containsMarkdownHeader(value)) return "Block cannot contain headers";
      return undefined;
    },
  },
  section: {
    name: "Section",
    description:
      "Content section with multiple blocks. Headers are not allowed (they serve as delimiters for multi-value fields).",
    validate: (value, _context) => {
      if (containsMarkdownHeader(value))
        return "Section cannot contain headers";
      return undefined;
    },
  },
  document: {
    name: "Document",
    description:
      "Complete document with full structure including headers. Horizontal rules (---) serve as delimiters for multi-value fields.",
    validate: (value, _context) => {
      if (containsHorizontalRule(value))
        return "Document cannot contain horizontal rules (---)";
      return undefined;
    },
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

const _validateDataTypeMapCompleteness: {
  [K in CoreDataType]: K extends keyof DataTypeValueMap ? true : false;
} = {} as {
  [K in CoreDataType]: true;
};
void _validateDataTypeMapCompleteness;

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
