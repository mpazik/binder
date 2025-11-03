import type { Fieldset, QueryParams } from "@binder/db";

export const parseStringQuery = (query: string): QueryParams => {
  const filters: Record<string, string> = {};
  const pairs = query.split(/\s+AND\s+|,/).map((p) => p.trim());
  for (const pair of pairs) {
    const [field, value] = pair.split("=").map((s) => s.trim());
    if (field && value) {
      filters[field] = value;
    }
  }
  return { filters };
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
