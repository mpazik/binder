import type { IsoDate, IsoTimestamp } from "@binder/utils";
import type { EntityId, EntityKey, EntityUid } from "./entity.ts";
import type { Filters, QueryParams } from "./query.ts";

export type DataTypeDef = {
  name: string;
  description?: string;
};
export type DataTypeDefs = Record<string, DataTypeDef>;

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
  period: { name: "Period" },
} as const satisfies DataTypeDefs;

export type TextFormatValidator = (
  value: string,
  context: {
    allowMultiple?: boolean;
  },
) => string | undefined;

export type TextFormatDef = DataTypeDef & {
  validate: TextFormatValidator;
  isMultiline?: boolean;
};
export type TextFormatDefs = Record<string, TextFormatDef>;

const createPatternValidator =
  (pattern: RegExp, errorMessage: string): TextFormatValidator =>
  (value, _context) =>
    pattern.test(value) ? undefined : errorMessage;

export const plaintextFormats = {
  identifier: {
    name: "Identifier",
    description:
      "Programmatic identifier starting with a letter, containing letters, digits, hyphens, and underscores (e.g., my-item_v2)",
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
  phrase: {
    name: "Phrase",
    description: "Short text without delimiter punctuation",
    validate: createPatternValidator(
      /^[^,;|\n]*$/,
      "Value must not contain commas, semicolons, pipes, or line breaks",
    ),
  },
  line: {
    name: "Line",
    description: "Single line of text that may contain any punctuation",
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
    isMultiline: true,
  },
  uri: {
    name: "URI",
    description:
      "Uniform Resource Identifier (e.g., https://example.com, file:///path, mailto:user@example.com)",
    validate: createPatternValidator(
      /^[a-zA-Z][a-zA-Z0-9+.-]*:.+$/,
      "Value must be a valid URI with scheme (e.g., https://...)",
    ),
  },
  filepath: {
    name: "File Path",
    description:
      "POSIX file path, absolute or relative (e.g., /home/user/file.txt, ./docs/readme.md)",
    validate: createPatternValidator(
      /^[^\0\n]*$/,
      "Value must be a valid POSIX file path",
    ),
  },
  semver: {
    name: "Semantic Version",
    description:
      "Semantic versioning format (e.g., 1.2.3, 2.0.0-beta.1+build.123)",
    validate: createPatternValidator(
      /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?$/,
      "Value must follow semantic versioning (MAJOR.MINOR.PATCH)",
    ),
  },
} as const satisfies TextFormatDefs;

const containsMarkdownHeader = (value: string): boolean =>
  /^#{1,6}\s/m.test(value);

const startsWithMarkdownHeader = (value: string): boolean =>
  /^#{1,6}\s/.test(value);

const containsHorizontalRule = (value: string): boolean =>
  /^-{3,}\s*$/m.test(value);

export const richtextFormats = {
  word: {
    name: "Word",
    description: "Single styled word without spaces",
    validate: createPatternValidator(
      /^\S*$/,
      "Value must be a single word without whitespace",
    ),
  },
  phrase: {
    name: "Phrase",
    description: "Short text with formatting but without delimiter punctuation",
    validate: createPatternValidator(
      /^[^,;|\n]*$/,
      "Value must not contain commas, semicolons, pipes, or line breaks",
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
      "Single content block such as a paragraph, list, or code block. No headers, blank lines, or horizontal rules allowed.",
    validate: (value) => {
      if (/\n\n/.test(value)) return "Value must not contain blank lines";
      if (containsMarkdownHeader(value)) return "Block cannot contain headers";
      if (containsHorizontalRule(value))
        return "Block cannot contain horizontal rules (---)";
      return undefined;
    },
    isMultiline: true,
  },
  section: {
    name: "Section",
    description: "Content section that must start with a header.",
    validate: (value) => {
      if (!startsWithMarkdownHeader(value))
        return "Section must start with a header (e.g., ## Title)";
      if (containsHorizontalRule(value))
        return "Section cannot contain horizontal rules (---)";
      return undefined;
    },
    isMultiline: true,
  },
  document: {
    name: "Document",
    description:
      "Complete document with full structure including headers. Horizontal rules (---) serve as delimiters for multi-value fields.",
    validate: (value) => {
      if (containsHorizontalRule(value))
        return "Document cannot contain horizontal rules (---)";
      return undefined;
    },
    isMultiline: true,
  },
} as const satisfies TextFormatDefs;

export const periodFormats = {
  day: {
    name: "Day",
    description: "YYYY-MM-DD (e.g. 2024-03-25)",
    validate: createPatternValidator(
      /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/,
      "Invalid day format",
    ),
  },
  week: {
    name: "Week",
    description: "YYYY-W## (e.g. 2024-W12)",
    validate: createPatternValidator(
      /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/,
      "Invalid week format",
    ),
  },
  month: {
    name: "Month",
    description: "YYYY-MM (e.g. 2024-03)",
    validate: createPatternValidator(
      /^\d{4}-(0[1-9]|1[0-2])$/,
      "Invalid month format",
    ),
  },
  quarter: {
    name: "Quarter",
    description: "YYYY-Q# (e.g. 2024-Q1)",
    validate: createPatternValidator(
      /^\d{4}-Q[1-4]$/,
      "Invalid quarter format",
    ),
  },
  year: {
    name: "Year",
    description: "YYYY (e.g. 2024)",
    validate: createPatternValidator(/^\d{4}$/, "Invalid year format"),
  },
} as const satisfies TextFormatDefs;

export type PlaintextFormat = keyof typeof plaintextFormats;
export type RichtextFormat = keyof typeof richtextFormats;
export type PeriodFormat = keyof typeof periodFormats;

export const DEFAULT_PLAINTEXT_FORMAT: PlaintextFormat = "line";
export const DEFAULT_RICHTEXT_FORMAT: RichtextFormat = "block";

export const getPlaintextFormat = (
  format: PlaintextFormat | undefined,
): TextFormatDef => plaintextFormats[format ?? DEFAULT_PLAINTEXT_FORMAT];

export const getRichtextFormat = (
  format: RichtextFormat | undefined,
): TextFormatDef => richtextFormats[format ?? DEFAULT_RICHTEXT_FORMAT];

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
  period: string;
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

export const plaintextFormatOptions = dataTypeDefsToOptions(plaintextFormats);
export const richtextFormatOptions = dataTypeDefsToOptions(richtextFormats);
export const periodFormatOptions = dataTypeDefsToOptions(periodFormats);

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
