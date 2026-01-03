import { mapObjectValues } from "@binder/utils";
import { z } from "zod";

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

const IncludesValueSchema = z.lazy(() =>
  z.union([z.boolean(), IncludesBaseSchema, NestedIncludesSchema]),
);
const IncludesBaseSchema: z.ZodType<any> = z.record(
  z.string(),
  IncludesValueSchema,
);
const NestedIncludesSchema = z.object({
  includes: IncludesBaseSchema.optional(),
  filters: FiltersSchema.optional(),
});

export const IncludesSchema = IncludesBaseSchema;
export type Includes = z.infer<typeof IncludesSchema>;
export type IncludesValue = z.infer<typeof IncludesValueSchema>;
export type NestedIncludes = z.infer<typeof NestedIncludesSchema>;

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

const isNestedIncludes = (value: IncludesValue): value is NestedIncludes =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const addUidToNested = (value: IncludesValue): IncludesValue => {
  if (!isNestedIncludes(value)) return value;
  if ("includes" in value || "filters" in value) {
    return {
      ...value,
      includes: value.includes
        ? includesWithUid(value.includes)
        : { uid: true },
    };
  }
  return includesWithUid(value as Includes);
};

export const includesWithUid = (includes: Includes): Includes => ({
  uid: true,
  ...mapObjectValues(includes, addUidToNested),
});
