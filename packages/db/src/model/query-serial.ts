import { fail, isErr, ok, type Result } from "@binder/utils";
import {
  isIncludesQuery,
  type ComplexFilter,
  type Filter,
  type FilterOperator,
  type Filters,
  type Includes,
  type IncludesQuery,
  type OrderBy,
} from "./query.ts";
import { IDENTIFIER_FORMAT_PATTERN } from "./text-format.ts";

// ---------------------------------------------------------------------------
// Value coercion
// ---------------------------------------------------------------------------

export const coerceFilterValue = (raw: string): string | number | boolean => {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+$/.test(raw)) return parseInt(raw, 10);
  if (/^-?\d+\.\d+$/.test(raw)) return parseFloat(raw);
  return raw;
};

const coerceListValue = (raw: string): (string | number)[] =>
  raw.split(",").map((v) => {
    const trimmed = v.trim();
    if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10);
    if (/^-?\d+\.\d+$/.test(trimmed)) return parseFloat(trimmed);
    return trimmed;
  });

// ---------------------------------------------------------------------------
// Filters — parse
// ---------------------------------------------------------------------------

type OperatorMatch = {
  field: string;
  op: FilterOperator | "eq";
  rawValue: string;
};

const namedOperators: {
  suffix: string;
  op: FilterOperator;
  hasValue: boolean;
}[] = [
  { suffix: ":notContains=", op: "notContains", hasValue: true },
  { suffix: ":contains=", op: "contains", hasValue: true },
  { suffix: ":notEmpty", op: "empty", hasValue: false },
  { suffix: ":empty", op: "empty", hasValue: false },
  { suffix: ":notIn=", op: "notIn", hasValue: true },
  { suffix: ":match=", op: "match", hasValue: true },
  { suffix: ":in=", op: "in", hasValue: true },
];

const symbolicOperators: { symbol: string; op: FilterOperator }[] = [
  { symbol: "!=", op: "not" },
  { symbol: ">=", op: "gte" },
  { symbol: "<=", op: "lte" },
  { symbol: ">", op: "gt" },
  { symbol: "<", op: "lt" },
];

const matchOperator = (token: string): OperatorMatch | null => {
  // Named operators (colon-prefixed)
  for (const { suffix, op, hasValue } of namedOperators) {
    const idx = token.indexOf(suffix);
    if (idx !== -1) {
      const field = token.slice(0, idx);
      if (!field) continue;
      const rawValue = hasValue ? token.slice(idx + suffix.length) : "";
      // :notEmpty → op "empty" but value is negated
      const isNegated = suffix.startsWith(":not") && !hasValue;
      return { field, op, rawValue: isNegated ? "__notEmpty__" : rawValue };
    }
  }

  // Symbolic operators
  for (const { symbol, op } of symbolicOperators) {
    const idx = token.indexOf(symbol);
    if (idx !== -1) {
      const field = token.slice(0, idx);
      if (!field) continue;
      return { field, op, rawValue: token.slice(idx + symbol.length) };
    }
  }

  // Simple equality
  const eqIdx = token.indexOf("=");
  if (eqIdx !== -1) {
    const field = token.slice(0, eqIdx);
    if (field) {
      return { field, op: "eq", rawValue: token.slice(eqIdx + 1) };
    }
  }

  return null;
};

const buildFilter = (match: OperatorMatch): Filter => {
  const { op, rawValue } = match;

  if (op === "eq") return coerceFilterValue(rawValue);

  if (op === "empty") {
    return { op: "empty", value: rawValue !== "__notEmpty__" };
  }

  if (op === "in" || op === "notIn") {
    return { op, value: coerceListValue(rawValue) };
  }

  return { op, value: coerceFilterValue(rawValue) } as ComplexFilter;
};

const getInValues = (filter: Filter): (string | number)[] | null => {
  if (typeof filter === "string" || typeof filter === "number") return [filter];
  if (
    typeof filter === "object" &&
    !Array.isArray(filter) &&
    filter.op === "in" &&
    Array.isArray(filter.value)
  )
    return filter.value;
  return null;
};

const mergeFilter = (existing: Filter, incoming: Filter): Filter => {
  const existingValues = getInValues(existing);
  const incomingValues = getInValues(incoming);
  if (existingValues && incomingValues)
    return { op: "in", value: [...existingValues, ...incomingValues] };
  return incoming;
};

/**
 * Parse an array of serial filter tokens into a Filters object.
 *
 * Tokens without an operator are collected as plain text (`$text`).
 *
 * @example
 * parseSerialFilters(["type=Task", "priority>=3", "urgent"])
 * // → { type: "Task", priority: { op: "gte", value: 3 }, $text: "urgent" }
 */
export const parseSerialFilters = (parts: string[]): Filters => {
  const filters: Filters = {};
  const plainTextParts: string[] = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const match = matchOperator(trimmed);
    if (!match) {
      plainTextParts.push(trimmed);
      continue;
    }

    const newFilter = buildFilter(match);
    const existing = filters[match.field];
    filters[match.field] =
      existing !== undefined ? mergeFilter(existing, newFilter) : newFilter;
  }

  if (plainTextParts.length > 0) {
    filters["$text"] = plainTextParts.join(" ");
  }

  return filters;
};

// ---------------------------------------------------------------------------
// Filters — serialize
// ---------------------------------------------------------------------------

const opToSymbol: Partial<Record<FilterOperator, string>> = {
  not: "!=",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
};

const opToNamed: Partial<Record<FilterOperator, string>> = {
  in: ":in=",
  notIn: ":notIn=",
  match: ":match=",
  contains: ":contains=",
  notContains: ":notContains=",
};

const serializeFilterEntry = (field: string, filter: Filter): string => {
  if (
    typeof filter === "string" ||
    typeof filter === "number" ||
    typeof filter === "boolean"
  ) {
    return `${field}=${filter}`;
  }

  if (Array.isArray(filter)) {
    return `${field}:in=${filter.join(",")}`;
  }

  const { op, value } = filter;

  if (op === "empty") {
    return value ? `${field}:empty` : `${field}:notEmpty`;
  }

  const sym = opToSymbol[op];
  if (sym) return `${field}${sym}${value}`;

  const named = opToNamed[op];
  if (named) {
    if (Array.isArray(value)) return `${field}${named}${value.join(",")}`;
    return `${field}${named}${value}`;
  }

  return `${field}=${value}`;
};

/**
 * Serialize a Filters object into an array of serial tokens.
 *
 * @example
 * serializeFilters({ type: "Task", priority: { op: "gte", value: 3 } })
 * // → ["type=Task", "priority>=3"]
 */
export const serializeFilters = (filters: Filters): string[] => {
  const parts: string[] = [];
  for (const [field, filter] of Object.entries(filters)) {
    if (field === "$text") {
      if (typeof filter === "string") parts.push(filter);
      continue;
    }
    parts.push(serializeFilterEntry(field, filter));
  }
  return parts;
};

// ---------------------------------------------------------------------------
// Includes — parse
// ---------------------------------------------------------------------------

const splitTopLevel = (input: string): string[] => {
  const segments: string[] = [];
  let parenDepth = 0;
  let bracketDepth = 0;
  let start = 0;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (ch === "(") parenDepth++;
    else if (ch === ")") parenDepth--;
    else if (ch === "[") bracketDepth++;
    else if (ch === "]") bracketDepth--;
    else if (ch === "," && parenDepth === 0 && bracketDepth === 0) {
      segments.push(input.slice(start, i));
      start = i + 1;
    }
  }

  segments.push(input.slice(start));
  return segments;
};

const parseIncludesInner = (input: string): Result<Includes> => {
  const trimmed = input.trim();
  if (!trimmed) return fail("empty-includes", "Includes cannot be empty");

  const segments = splitTopLevel(trimmed);
  const includes: Includes = {};

  for (const segment of segments) {
    const seg = segment.trim();
    if (!seg) return fail("empty-field-name", "Empty field name in includes");

    const bracketIdx = seg.indexOf("[");
    const parenIdx = seg.indexOf("(");

    if (bracketIdx === -1 && parenIdx === -1) {
      // Simple field: "title"
      if (!IDENTIFIER_FORMAT_PATTERN.test(seg)) {
        return fail("invalid-field-name", `Invalid field name: '${seg}'`, {
          field: seg,
        });
      }
      includes[seg] = true;
    } else if (bracketIdx !== -1) {
      // Filtered field: "field[filters]" or "field[filters](subfields)"
      const fieldName = seg.slice(0, bracketIdx).trim();
      if (!fieldName || !IDENTIFIER_FORMAT_PATTERN.test(fieldName)) {
        return fail(
          "invalid-field-name",
          `Invalid field name: '${fieldName}'`,
          { field: fieldName },
        );
      }

      const closeBracketIdx = seg.indexOf("]", bracketIdx);
      if (closeBracketIdx === -1) {
        return fail("unmatched-bracket", "Unmatched opening bracket", {
          field: fieldName,
        });
      }

      const filterStr = seg.slice(bracketIdx + 1, closeBracketIdx).trim();
      if (!filterStr) {
        return fail("empty-filter", "Empty filter in brackets", {
          field: fieldName,
        });
      }

      const filterTokens = filterStr.split(",").map((s) => s.trim());
      const filters = parseSerialFilters(filterTokens);
      const query: IncludesQuery = { filters };

      const afterBracket = seg.slice(closeBracketIdx + 1).trim();
      if (afterBracket) {
        // Expect "(subfields)"
        if (!afterBracket.startsWith("(") || !afterBracket.endsWith(")")) {
          return fail(
            "unmatched-paren",
            "Unmatched parenthesis after bracket",
            {
              field: fieldName,
            },
          );
        }
        const inner = afterBracket.slice(1, -1);
        const result = parseIncludesInner(inner);
        if (isErr(result)) return result;
        query.includes = result.data;
      }

      includes[fieldName] = query;
    } else {
      // Nested field without filter: "field(subfields)"
      const fieldName = seg.slice(0, parenIdx).trim();
      if (!fieldName || !IDENTIFIER_FORMAT_PATTERN.test(fieldName)) {
        return fail(
          "invalid-field-name",
          `Invalid field name: '${fieldName}'`,
          { field: fieldName },
        );
      }

      if (!seg.endsWith(")")) {
        return fail("unmatched-paren", "Unmatched opening parenthesis", {
          field: fieldName,
        });
      }

      const inner = seg.slice(parenIdx + 1, -1);
      const result = parseIncludesInner(inner);
      if (isErr(result)) return result;
      includes[fieldName] = result.data;
    }
  }

  return ok(includes);
};

/**
 * Parse a serial includes string into an Includes object.
 *
 * @example
 * parseSerialIncludes("project(title,owner(name)),tags")
 * // → { project: { title: true, owner: { name: true } }, tags: true }
 */
export const parseSerialIncludes = (input: string): Result<Includes> => {
  const trimmed = input.trim();
  if (!trimmed) return fail("empty-includes", "Includes cannot be empty");

  // Check for unmatched parentheses and brackets
  let parenDepth = 0;
  let bracketDepth = 0;
  let lastCloseParen = -1;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!;
    if (ch === "(") parenDepth++;
    else if (ch === ")") {
      parenDepth--;
      lastCloseParen = i;
    } else if (ch === "[") {
      if (lastCloseParen !== -1 && parenDepth === 0) {
        // Check if this bracket follows a paren at the same nesting level
        // e.g. "field(title)[type=Task]" — brackets must come before parens
        const between = trimmed.slice(lastCloseParen + 1, i).trim();
        if (!between.includes(",")) {
          return fail(
            "brackets-after-parens",
            "Brackets must appear before parentheses",
          );
        }
      }
      bracketDepth++;
    } else if (ch === "]") bracketDepth--;
    if (parenDepth < 0)
      return fail("unmatched-paren", "Unmatched closing parenthesis");
    if (bracketDepth < 0)
      return fail("unmatched-bracket", "Unmatched closing bracket");
  }
  if (parenDepth !== 0)
    return fail("unmatched-paren", "Unmatched opening parenthesis");
  if (bracketDepth !== 0)
    return fail("unmatched-bracket", "Unmatched opening bracket");

  return parseIncludesInner(trimmed);
};

// ---------------------------------------------------------------------------
// Includes — serialize
// ---------------------------------------------------------------------------

/**
 * Serialize an Includes object into the serial parenthesized format.
 *
 * @example
 * serializeIncludes({ project: { title: true }, tags: true })
 * // → "project(title),tags"
 */
export const serializeIncludes = (includes: Includes): string => {
  const parts: string[] = [];

  for (const [field, value] of Object.entries(includes)) {
    if (value === false) continue;
    if (value === true) {
      parts.push(field);
    } else if (isIncludesQuery(value)) {
      let part = field;
      if (value.filters && Object.keys(value.filters).length > 0) {
        part += `[${serializeFilters(value.filters).join(",")}]`;
      }
      if (value.includes && Object.keys(value.includes).length > 0) {
        part += `(${serializeIncludes(value.includes)})`;
      }
      parts.push(part);
    } else {
      parts.push(`${field}(${serializeIncludes(value as Includes)})`);
    }
  }

  return parts.join(",");
};

// ---------------------------------------------------------------------------
// OrderBy — parse / serialize
// ---------------------------------------------------------------------------

/**
 * Parse a serial orderBy string into an OrderBy array.
 *
 * @example
 * parseSerialOrderBy("!priority,createdAt")
 * // → ["!priority", "createdAt"]
 */
export const parseSerialOrderBy = (input: string): OrderBy =>
  input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Serialize an OrderBy array into the serial format.
 *
 * @example
 * serializeOrderBy(["!priority", "createdAt"])
 * // → "!priority,createdAt"
 */
export const serializeOrderBy = (orderBy: OrderBy): string => orderBy.join(",");
