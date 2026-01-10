import {
  type EntitySchema,
  type EntityType,
  type Fieldset,
  type Filter,
  type Filters,
  isComplexFilter,
  type AncestralFieldsetChain,
  type QueryParams,
} from "@binder/db";
import { fail, isErr, ok, type Result } from "@binder/utils";
import {
  extractFieldNames,
  interpolateAncestralFields,
  parseAncestralPlaceholder,
} from "./interpolate-fields.ts";

export const formatWhenCondition = (filters: Filters): string =>
  Object.entries(filters)
    .map(([field, filter]) => {
      if (isComplexFilter(filter)) {
        const { op, value } = filter;
        if (op === "not") return `${field}!=${value}`;
        if (op === "in" && Array.isArray(value))
          return `${field}=${value.join("|")}`;
        return `${field}=${value}`;
      }
      return `${field}=${filter}`;
    })
    .join(", ");

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

  const filters: Record<string, string> = {};
  const pairs = result.data.split(/\s+AND\s+|,/).map((p: string) => p.trim());

  for (const pair of pairs) {
    const [field, value] = pair.split("=").map((s: string) => s.trim());
    if (field && value) {
      filters[field] = value;
    }
  }

  return ok({ filters });
};

export const queryParamsToString = (queryParams: QueryParams): string => {
  const filters = queryParams.filters || {};
  return Object.entries(filters)
    .map(([key, value]) => `${key}=${value}`)
    .join(" AND ");
};

export const stringifyQuery = (params: QueryParams): string => {
  if (!params.filters) return "";

  const pairs: string[] = [];
  for (const [field, filter] of Object.entries(params.filters)) {
    if (typeof filter === "string") {
      pairs.push(`${field}=${filter}`);
    } else if (typeof filter === "number" || typeof filter === "boolean") {
      pairs.push(`${field}=${filter}`);
    } else if (
      typeof filter === "object" &&
      filter !== null &&
      !Array.isArray(filter)
    ) {
      if (filter.op === "eq" && filter.value !== undefined) {
        pairs.push(`${field}=${filter.value}`);
      }
    }
  }
  return pairs.join(" AND ");
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
