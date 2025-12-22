import { includes } from "@binder/utils";
import { and, sql, type SQL } from "drizzle-orm";
import { tableStoredFields, type nodeTable, type configTable } from "./schema";
import type {
  ComplexFilter,
  EntitySchema,
  Fieldset,
  FieldValue,
  Filter,
  Filters,
} from "./model";
import { getFieldDef } from "./model";

type EntityTable = typeof nodeTable | typeof configTable;

export const isComplexFilter = (filter: Filter): filter is ComplexFilter => {
  return (
    typeof filter === "object" &&
    filter !== null &&
    "op" in filter &&
    "value" in filter
  );
};

type NormalizedFilter = ComplexFilter | string | number | boolean;

export const normalizeFilter = (filter: Filter): NormalizedFilter => {
  if (Array.isArray(filter)) return { op: "in", value: filter };
  return filter as NormalizedFilter;
};

const isComplexNormalized = (
  filter: NormalizedFilter,
): filter is ComplexFilter => typeof filter === "object" && filter !== null;

const matchesNormalizedFilter = (
  filter: NormalizedFilter,
  value: FieldValue,
): boolean => {
  if (!isComplexNormalized(filter)) {
    return value === filter;
  }

  const { op, value: filterValue } = filter;

  switch (op) {
    case "eq":
      return value === filterValue;
    case "not":
      return value !== filterValue;
    case "in":
      return (
        Array.isArray(filterValue) &&
        (typeof value === "string" || typeof value === "number") &&
        filterValue.includes(value)
      );
    case "notIn":
      return (
        Array.isArray(filterValue) &&
        (typeof value === "string" || typeof value === "number") &&
        !filterValue.includes(value)
      );
    case "contains":
      return (
        typeof value === "string" &&
        typeof filterValue === "string" &&
        value.includes(filterValue)
      );
    case "notContains":
      return (
        typeof value === "string" &&
        typeof filterValue === "string" &&
        !value.includes(filterValue)
      );
    case "match":
      return (
        typeof value === "string" &&
        typeof filterValue === "string" &&
        value.includes(filterValue)
      );
    case "lt":
      return (
        (typeof value === "number" || typeof value === "string") &&
        value < (filterValue as number | string)
      );
    case "lte":
      return (
        (typeof value === "number" || typeof value === "string") &&
        value <= (filterValue as number | string)
      );
    case "gt":
      return (
        (typeof value === "number" || typeof value === "string") &&
        value > (filterValue as number | string)
      );
    case "gte":
      return (
        (typeof value === "number" || typeof value === "string") &&
        value >= (filterValue as number | string)
      );
    case "empty":
      return filterValue === true
        ? value == null || value === ""
        : value != null && value !== "";
    default:
      return false;
  }
};

export const matchesFilter = (filter: Filter, value: FieldValue): boolean =>
  matchesNormalizedFilter(normalizeFilter(filter), value);

export const matchesFilters = (filters: Filters, entity: Fieldset): boolean => {
  for (const [fieldKey, filter] of Object.entries(filters)) {
    if (!matchesFilter(filter, entity[fieldKey])) return false;
  }
  return true;
};

const getFieldSql = (table: EntityTable, fieldKey: string): SQL => {
  if (includes(tableStoredFields, fieldKey)) {
    const column = table[fieldKey as keyof EntityTable];
    return sql`${column}`;
  }
  return sql`json_extract(${table.fields}, ${`$.${fieldKey}`})`;
};

const buildFilterCondition = (
  table: EntityTable,
  fieldKey: string,
  filter: Filter,
  schema?: EntitySchema,
): SQL | undefined => {
  const fieldSql = getFieldSql(table, fieldKey);
  const normalized = normalizeFilter(filter);
  const fieldDef = schema ? getFieldDef(schema, fieldKey) : undefined;
  const isMultiValue = fieldDef?.allowMultiple === true;

  if (!isComplexNormalized(normalized)) {
    if (isMultiValue) {
      return sql`EXISTS (SELECT 1 FROM json_each(${fieldSql}) WHERE value = ${normalized})`;
    }
    return sql`${fieldSql} = ${normalized}`;
  }

  const { op, value } = normalized;

  switch (op) {
    case "eq":
      if (isMultiValue) {
        return sql`EXISTS (SELECT 1 FROM json_each(${fieldSql}) WHERE value = ${value})`;
      }
      return sql`${fieldSql} = ${value}`;

    case "not":
      if (isMultiValue) {
        return sql`NOT EXISTS (SELECT 1 FROM json_each(${fieldSql}) WHERE value = ${value})`;
      }
      return sql`${fieldSql} != ${value}`;

    case "in":
      if (!Array.isArray(value) || value.length === 0) return undefined;
      if (isMultiValue) {
        return sql`EXISTS (SELECT 1 FROM json_each(${fieldSql}) WHERE value IN (${sql.join(
          value.map((v) => sql`${v}`),
          sql`, `,
        )}))`;
      }
      return sql`${fieldSql} IN (${sql.join(
        value.map((v) => sql`${v}`),
        sql`, `,
      )})`;

    case "notIn":
      if (!Array.isArray(value) || value.length === 0) return undefined;
      if (isMultiValue) {
        return sql`NOT EXISTS (SELECT 1 FROM json_each(${fieldSql}) WHERE value IN (${sql.join(
          value.map((v) => sql`${v}`),
          sql`, `,
        )}))`;
      }
      return sql`${fieldSql} NOT IN (${sql.join(
        value.map((v) => sql`${v}`),
        sql`, `,
      )})`;

    case "contains":
      if (typeof value !== "string") return undefined;
      return sql`${fieldSql} LIKE ${"%" + value + "%"}`;

    case "notContains":
      if (typeof value !== "string") return undefined;
      return sql`${fieldSql} NOT LIKE ${"%" + value + "%"}`;

    case "match":
      if (typeof value !== "string") return undefined;
      return sql`${fieldSql} LIKE ${"%" + value + "%"}`;

    case "lt":
      return sql`${fieldSql} < ${value}`;

    case "lte":
      return sql`${fieldSql} <= ${value}`;

    case "gt":
      return sql`${fieldSql} > ${value}`;

    case "gte":
      return sql`${fieldSql} >= ${value}`;

    case "empty":
      if (value === true) {
        return sql`(${fieldSql} IS NULL OR ${fieldSql} = '')`;
      } else {
        return sql`(${fieldSql} IS NOT NULL AND ${fieldSql} != '')`;
      }

    default:
      return undefined;
  }
};

export const buildWhereClause = (
  table: EntityTable,
  filters: Filters,
  schema?: EntitySchema,
): SQL | undefined => {
  const conditions: SQL[] = [];

  for (const [fieldKey, filter] of Object.entries(filters)) {
    const condition = buildFilterCondition(table, fieldKey, filter, schema);
    if (condition) conditions.push(condition);
  }

  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];

  return and(...conditions);
};
