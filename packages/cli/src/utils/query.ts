import {
  type EntitySchema,
  type EntityType,
  type Fieldset,
  type Filter,
  type Filters,
  type AncestralFieldsetChain,
  type QueryParams,
  serializeFilters,
} from "@binder/db";
import { fail, isErr, ok, type Result } from "@binder/utils";
import {
  extractFieldNames,
  interpolateAncestralFields,
  parseAncestralPlaceholder,
} from "./interpolate-fields.ts";

export const formatWhenCondition = (filters: Filters): string =>
  serializeFilters(filters).join(", ");

const interpolateFilterValue = (
  schema: EntitySchema,
  filter: Filter,
  context: AncestralFieldsetChain,
): Result<Filter> => {
  if (typeof filter === "string") {
    const result = interpolateAncestralFields(schema, filter, context);
    if (isErr(result)) return result;
    return ok(result.data);
  }

  if (
    typeof filter === "object" &&
    filter !== null &&
    !Array.isArray(filter) &&
    "op" in filter
  ) {
    if (typeof filter.value === "string") {
      const result = interpolateAncestralFields(schema, filter.value, context);
      if (isErr(result)) return result;
      return ok({ ...filter, value: result.data });
    }
  }

  return ok(filter);
};

export const interpolateQueryParams = (
  schema: EntitySchema,
  queryParams: QueryParams,
  context: AncestralFieldsetChain,
): Result<QueryParams> => {
  if (!queryParams.filters) return ok(queryParams);

  const interpolatedFilters: Record<string, Filter> = {};
  for (const [key, filter] of Object.entries(queryParams.filters)) {
    const result = interpolateFilterValue(schema, filter, context);
    if (isErr(result)) return result;
    interpolatedFilters[key] = result.data;
  }

  return ok({ ...queryParams, filters: interpolatedFilters });
};

export const parseStringQuery = (
  schema: EntitySchema,
  query: string,
  parents: AncestralFieldsetChain = [],
): Result<QueryParams> => {
  const fieldNames = extractFieldNames(query);
  for (const fieldName of fieldNames) {
    const { depth } = parseAncestralPlaceholder(fieldName);
    if (depth === 0) {
      return fail(
        "invalid-placeholder",
        `Invalid placeholder format: {${fieldName}}`,
        { fieldName },
      );
    }
    if (depth > parents.length) {
      return fail(
        "context-not-found",
        `Parent context at index ${depth} not found`,
        {
          parentIndex: depth,
          stackSize: parents.length,
        },
      );
    }
  }

  const result = interpolateAncestralFields(schema, query, [{}, ...parents]);
  if (isErr(result)) return result;

  return ok({ filters: parseFiltersFromString(result.data) ?? {} });
};

export const parseFiltersFromString = (query: string): Filters | undefined => {
  const filters: Filters = {};
  const pairs = query.split(/\s+AND\s+|,/).map((p) => p.trim());
  for (const pair of pairs) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx === -1) continue;
    const field = pair.slice(0, eqIdx).trim();
    const value = pair.slice(eqIdx + 1).trim();
    if (field && value) {
      filters[field] = value;
    }
  }
  return Object.keys(filters).length > 0 ? filters : undefined;
};

export const extractFieldsetFromQuery = (params: QueryParams): Fieldset => {
  const fieldset: Fieldset = {};
  if (!params.filters) return fieldset;

  for (const [field, filter] of Object.entries(params.filters)) {
    if (typeof filter === "string") {
      fieldset[field] = filter;
    } else if (typeof filter === "number" || typeof filter === "boolean") {
      fieldset[field] = filter;
    } else if (Array.isArray(filter)) {
      fieldset[field] = filter;
    } else if (typeof filter === "object" && filter !== null) {
      if (filter.op === "eq") {
        fieldset[field] = filter.value;
      }
    }
  }
  return fieldset;
};

export const getTypeFromFilters = (
  filters: Filters,
): EntityType | undefined => {
  const typeFilter = filters?.type;
  if (!typeFilter) return undefined;
  if (typeof typeFilter === "string") return typeFilter as EntityType;
  if (typeof typeFilter === "object" && "value" in typeFilter)
    return String(typeFilter.value) as EntityType;
  return undefined;
};
