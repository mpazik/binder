import { mapObjectValues } from "@binder/utils";
import { z } from "zod";
import {
  isFieldsetNested,
  type FieldNestedValue,
  type FieldsetNested,
} from "./field.ts";

const FilterOperatorSchema = z.enum([
  "eq",
  "not",
  "in",
  "notIn",
  "contains",
  "notContains",
  "match",
  "lt",
  "lte",
  "gt",
  "gte",
  "empty",
]);
export type FilterOperator = z.infer<typeof FilterOperatorSchema>;

const FilterValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number()])),
]);
export type FilterValue = z.infer<typeof FilterValueSchema>;

const SimpleFilterSchema = FilterValueSchema;
export type SimpleFilter = z.infer<typeof SimpleFilterSchema>;

const ComplexFilterSchema = z.object({
  op: FilterOperatorSchema,
  value: FilterValueSchema,
});
export type ComplexFilter = z.infer<typeof ComplexFilterSchema>;

const FilterSchema = z.union([SimpleFilterSchema, ComplexFilterSchema]);
export type Filter = z.infer<typeof FilterSchema>;

export const FiltersSchema = z.record(z.string(), FilterSchema);
export type Filters = z.infer<typeof FiltersSchema>;

export type IncludesQuery = {
  includes?: Includes;
  filters?: Filters;
};
export type Includes = { [key: string]: IncludesValue };
export type IncludesValue = boolean | Includes | IncludesQuery;

const IncludesValueSchema: z.ZodType<IncludesValue> = z.lazy(() =>
  z.union([z.boolean(), IncludesBaseSchema, IncludesQuerySchema]),
);
const IncludesBaseSchema: z.ZodType<Includes> = z.record(
  z.string(),
  IncludesValueSchema,
);
const IncludesQuerySchema: z.ZodType<IncludesQuery> = z.object({
  includes: IncludesBaseSchema.optional(),
  filters: FiltersSchema.optional(),
});

export const IncludesSchema = IncludesBaseSchema;

const PaginationSchema = z.object({
  limit: z.number().int().positive().optional(),
  after: z.string().optional(),
  before: z.string().optional(),
});
export type Pagination = z.infer<typeof PaginationSchema>;

const OrderBySchema = z.array(z.string());
export type OrderBy = z.infer<typeof OrderBySchema>;

export const QueryParamsSchema = z.object({
  filters: FiltersSchema.optional(),
  includes: IncludesSchema.optional(),
  orderBy: OrderBySchema.optional(),
  pagination: PaginationSchema.optional(),
});
export type QueryParams = z.infer<typeof QueryParamsSchema>;

const PaginationInfoSchema = z.object({
  hasNext: z.boolean(),
  hasPrevious: z.boolean(),
  nextCursor: z.string().nullable(),
  previousCursor: z.string().nullable(),
});
export type PaginationInfo = z.infer<typeof PaginationInfoSchema>;

export const isIncludesQuery = (value: IncludesValue): value is IncludesQuery =>
  typeof value === "object" &&
  value !== null &&
  ("includes" in value || "filters" in value);

export const isObjectIncludes = (
  value: IncludesValue,
): value is IncludesQuery | Includes =>
  typeof value === "object" && value !== null;

const addUidToIncludesRecursively = (value: IncludesValue): IncludesValue => {
  if (typeof value === "boolean") return value;
  if (isIncludesQuery(value)) {
    return {
      ...value,
      includes: value.includes
        ? includesWithUid(value.includes)
        : { uid: true },
    };
  }
  return includesWithUid(value);
};

export const includesWithUid = (includes: Includes): Includes => ({
  uid: true,
  ...mapObjectValues(includes, addUidToIncludesRecursively),
});

export const mergeIncludes = (
  a: Includes | undefined,
  b: Includes | undefined,
): Includes | undefined => {
  if (!a && !b) return undefined;
  if (!a) return b;
  if (!b) return a;

  const result: Includes = { ...a };
  for (const [key, value] of Object.entries(b)) {
    const existing = result[key];
    if (typeof existing === "object" && typeof value === "object") {
      result[key] = mergeIncludes(existing as Includes, value as Includes)!;
    } else if (typeof existing === "object" && value === true) {
      // true means "reference only" — inject key/uid into the object
      result[key] = { key: true, uid: true, ...(existing as Includes) };
    } else if (typeof value === "object" && existing === true) {
      // true means "reference only" — inject key/uid into the object
      result[key] = { key: true, uid: true, ...(value as Includes) };
    } else {
      result[key] = value;
    }
  }
  return result;
};

export const buildIncludes = (
  fieldPaths: readonly (readonly string[])[],
): Includes | undefined => {
  if (fieldPaths.length === 0) return undefined;

  const includes: Includes = {};

  for (const path of fieldPaths) {
    if (path.length === 0) continue;

    let current = includes;
    for (let i = 0; i < path.length; i++) {
      const key = path[i]!;
      if (i === path.length - 1) {
        current[key] = true;
      } else {
        if (typeof current[key] !== "object") current[key] = {};
        current = current[key] as Includes;
      }
    }
  }

  return Object.keys(includes).length > 0 ? includes : undefined;
};

const collapseToReference = (
  value: FieldsetNested,
): string | FieldsetNested => {
  if ("key" in value && typeof value.key === "string") return value.key;
  if ("uid" in value && typeof value.uid === "string")
    return value.uid as string;
  return value;
};

const pickValue = (
  value: FieldNestedValue,
  nested: Includes | undefined,
): FieldNestedValue => {
  if (!nested) {
    if (isFieldsetNested(value)) return collapseToReference(value);
    if (Array.isArray(value))
      return value.map((item) =>
        isFieldsetNested(item) ? collapseToReference(item) : item,
      );
    return value;
  }
  if (isFieldsetNested(value)) return pickByIncludes(value, nested);
  if (Array.isArray(value))
    return value.map((item) =>
      isFieldsetNested(item) ? pickByIncludes(item, nested) : item,
    );
  return value;
};

export const pickByIncludes = (
  entity: FieldsetNested,
  includes: Includes,
): FieldsetNested => {
  const result: FieldsetNested = {};

  for (const [key, includeValue] of Object.entries(includes)) {
    const value = entity[key];
    if (value === undefined || value === null) continue;
    if (includeValue === false) continue;

    const nested =
      includeValue === true
        ? undefined
        : isIncludesQuery(includeValue)
          ? includeValue.includes
          : includeValue;

    result[key] = pickValue(value, nested);
  }

  return result;
};
