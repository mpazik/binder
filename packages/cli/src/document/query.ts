import type { QueryParams } from "@binder/db";

export const parseStringQuery = (query: string): QueryParams => {
  const filters: Record<string, string> = {};
  const pairs = query.split(",").map((p) => p.trim());
  for (const pair of pairs) {
    const [field, value] = pair.split("=").map((s) => s.trim());
    if (field && value) {
      filters[field] = value;
    }
  }
  return { filters };
};
