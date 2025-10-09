import type { QueryParams } from "@binder/db";

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

export const extractFieldsetFromQuery = (
  query: string,
): Record<string, string> => {
  const fieldset: Record<string, string> = {};
  const pairs = query.split(/\s+AND\s+|,/).map((p) => p.trim());
  for (const pair of pairs) {
    const [field, value] = pair.split("=").map((s) => s.trim());
    if (field && value) {
      fieldset[field] = value;
    }
  }
  return fieldset;
};
