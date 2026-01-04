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
