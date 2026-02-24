import { fail, type JsonValue, ok, type Result } from "@binder/utils";
import { type DataTypeDef, dataTypeDefsToOptions } from "./data-type.ts";
import type { FieldDef } from "./schema.ts";

type FieldValue = JsonValue;

export type MultiValueDelimiter =
  | "comma"
  | "newline"
  | "blankline"
  | "header"
  | "hrule";

export type TextFormatValidator = (
  value: string,
  context: { allowMultiple?: boolean },
) => string | undefined;

export type TextFormatDef = DataTypeDef & {
  validate: TextFormatValidator;
  isMultiline?: boolean;
  delimiter?: MultiValueDelimiter;
};

export type TextFormatDefs = Record<string, TextFormatDef>;

export const createPatternValidator =
  (pattern: RegExp, errorMessage: string): TextFormatValidator =>
  (value, _context) =>
    pattern.test(value) ? undefined : errorMessage;

const containsMarkdownHeader = (value: string): boolean =>
  /^#{1,6}\s/m.test(value);

const startsWithMarkdownHeader = (value: string): boolean =>
  /^#{1,6}\s/.test(value);

const containsHorizontalRule = (value: string): boolean =>
  /^-{3,}\s*$/m.test(value);

export const plaintextFormats = {
  identifier: {
    name: "Identifier",
    description:
      "Programmatic identifier starting with a letter, containing letters, digits, hyphens, and underscores (e.g., my-item_v2)",
    validate: createPatternValidator(
      /^[A-Za-z][A-Za-z0-9_-]*$/,
      "Value must start with a letter and contain only letters, digits, hyphens, and underscores",
    ),
    delimiter: "comma",
  },
  word: {
    name: "Word",
    description: "Single word without any whitespace characters",
    validate: createPatternValidator(
      /^\S*$/,
      "Value must be a single word without whitespace",
    ),
    delimiter: "comma",
  },
  phrase: {
    name: "Phrase",
    description: "Short text without delimiter punctuation",
    validate: createPatternValidator(
      /^[^,;|\n]*$/,
      "Value must not contain commas, semicolons, pipes, or line breaks",
    ),
    delimiter: "comma",
  },
  line: {
    name: "Line",
    description: "Single line of text that may contain any punctuation",
    validate: createPatternValidator(
      /^[^\n]*$/,
      "Value must be a single line without line breaks",
    ),
    delimiter: "newline",
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
    delimiter: "blankline",
  },
  uri: {
    name: "URI",
    description:
      "Uniform Resource Identifier (e.g., https://example.com, file:///path, mailto:user@example.com)",
    validate: createPatternValidator(
      /^[a-zA-Z][a-zA-Z0-9+.-]*:.+$/,
      "Value must be a valid URI with scheme (e.g., https://...)",
    ),
    delimiter: "newline",
  },
  filepath: {
    name: "File Path",
    description:
      "POSIX file path, absolute or relative (e.g., /home/user/file.txt, ./docs/readme.md)",
    validate: createPatternValidator(
      /^[^\0\n]*$/,
      "Value must be a valid POSIX file path",
    ),
    delimiter: "newline",
  },
  semver: {
    name: "Semantic Version",
    description:
      "Semantic versioning format (e.g., 1.2.3, 2.0.0-beta.1+build.123)",
    validate: createPatternValidator(
      /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?$/,
      "Value must follow semantic versioning (MAJOR.MINOR.PATCH)",
    ),
    delimiter: "comma",
  },
} as const satisfies TextFormatDefs;

export const richtextFormats = {
  word: {
    name: "Word",
    description: "Single styled word without spaces",
    validate: createPatternValidator(
      /^\S*$/,
      "Value must be a single word without whitespace",
    ),
    delimiter: "comma",
  },
  phrase: {
    name: "Phrase",
    description: "Short text with formatting but without delimiter punctuation",
    validate: createPatternValidator(
      /^[^,;|\n]*$/,
      "Value must not contain commas, semicolons, pipes, or line breaks",
    ),
    delimiter: "comma",
  },
  line: {
    name: "Line",
    description:
      "Single line that may contain inline formatting but no line breaks",
    validate: createPatternValidator(
      /^[^\n]*$/,
      "Value must be a single line without line breaks",
    ),
    delimiter: "newline",
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
    delimiter: "blankline",
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
    delimiter: "header",
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
    delimiter: "hrule",
  },
} as const satisfies TextFormatDefs;

export type PlaintextFormat = keyof typeof plaintextFormats;
export type RichtextFormat = keyof typeof richtextFormats;

export const DEFAULT_PLAINTEXT_FORMAT: PlaintextFormat = "line";
export const DEFAULT_RICHTEXT_FORMAT: RichtextFormat = "block";

export const getPlaintextFormat = (
  format: PlaintextFormat | undefined,
): TextFormatDef => plaintextFormats[format ?? DEFAULT_PLAINTEXT_FORMAT];

export const getRichtextFormat = (
  format: RichtextFormat | undefined,
): TextFormatDef => richtextFormats[format ?? DEFAULT_RICHTEXT_FORMAT];

export const plaintextFormatOptions = dataTypeDefsToOptions(plaintextFormats);
export const richtextFormatOptions = dataTypeDefsToOptions(richtextFormats);

export const getMultiValueDelimiter = (
  fieldDef: FieldDef,
): MultiValueDelimiter => {
  if (fieldDef.dataType === "plaintext")
    return getPlaintextFormat(fieldDef.plaintextFormat).delimiter ?? "comma";
  if (fieldDef.dataType === "richtext")
    return getRichtextFormat(fieldDef.richtextFormat).delimiter ?? "comma";
  return "comma";
};

export const getDelimiterString = (delimiter: MultiValueDelimiter): string => {
  switch (delimiter) {
    case "comma":
      return ", ";
    case "newline":
      return "\n";
    case "blankline":
    case "header":
      return "\n\n";
    case "hrule":
      return "\n\n---\n\n";
  }
};

const splitByHeader = (value: string): string[] => {
  const headerPattern = /^#{1,6}\s/;
  const lines = value.split("\n");
  const sections: string[] = [];
  let currentSection: string[] = [];

  for (const line of lines) {
    if (headerPattern.test(line) && currentSection.length > 0) {
      sections.push(currentSection.join("\n").trim());
      currentSection = [line];
    } else {
      currentSection.push(line);
    }
  }

  if (currentSection.length > 0) {
    const trimmed = currentSection.join("\n").trim();
    if (trimmed) sections.push(trimmed);
  }

  return sections;
};

const splitByHorizontalRule = (value: string): string[] =>
  value.split(/^-{3,}\s*$/m).map((item) => item.trim());

export const splitByDelimiter = (
  value: string,
  delimiter: MultiValueDelimiter,
): string[] => {
  switch (delimiter) {
    case "comma":
      return value.split(",").map((item) => item.trim());
    case "newline":
      return value.split("\n").map((item) => item.trim());
    case "blankline":
      return value.split(/\n\n+/).map((item) => item.trim());
    case "header":
      return splitByHeader(value);
    case "hrule":
      return splitByHorizontalRule(value);
  }
};

export const isMultilineFormat = (fieldDef: FieldDef): boolean => {
  if (fieldDef.dataType === "plaintext")
    return getPlaintextFormat(fieldDef.plaintextFormat).isMultiline ?? false;
  if (fieldDef.dataType === "richtext")
    return getRichtextFormat(fieldDef.richtextFormat).isMultiline ?? false;
  return false;
};

export const parseFieldValue = (
  raw: string,
  fieldDef: FieldDef,
): Result<FieldValue> => {
  const trimmed = raw.trim();

  if (fieldDef.allowMultiple) {
    if (trimmed === "") return ok([]);
    const delimiter = getMultiValueDelimiter(fieldDef);
    const items = splitByDelimiter(trimmed, delimiter).filter(
      (item) => item.length > 0,
    );
    return ok(items);
  }

  if (trimmed === "") return ok(null);

  if (fieldDef.dataType === "seqId" || fieldDef.dataType === "integer") {
    const parsed = parseInt(trimmed, 10);
    if (isNaN(parsed))
      return fail("invalid-field-value", `Invalid integer: ${trimmed}`);
    return ok(parsed);
  }

  if (fieldDef.dataType === "decimal") {
    const parsed = parseFloat(trimmed);
    if (isNaN(parsed))
      return fail("invalid-field-value", `Invalid decimal: ${trimmed}`);
    return ok(parsed);
  }

  if (fieldDef.dataType === "boolean") {
    const lower = trimmed.toLowerCase();
    if (lower === "true" || lower === "yes" || lower === "on" || lower === "1")
      return ok(true);
    if (lower === "false" || lower === "no" || lower === "off" || lower === "0")
      return ok(false);
    return fail("invalid-field-value", `Invalid boolean: ${trimmed}`);
  }

  return ok(trimmed);
};

const stringifySingleValue = (value: FieldValue): string => {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

export const stringifyFieldValue = (
  value: FieldValue | undefined,
  fieldDef: FieldDef,
): string => {
  if (value === null || value === undefined) return "";

  if (Array.isArray(value)) {
    if (value.length === 0) return "";
    const delimiter = getDelimiterString(getMultiValueDelimiter(fieldDef));
    return value.map(stringifySingleValue).join(delimiter);
  }

  return stringifySingleValue(value);
};
