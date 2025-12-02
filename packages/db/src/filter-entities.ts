import { and, sql, type SQL } from "drizzle-orm";
import { tableStoredFields, type nodeTable, type configTable } from "./schema";
import type {
  ComplexFilter,
  Fieldset,
  FieldValue,
  Filter,
  Filters,
} from "./model";

type EntityTable = typeof nodeTable | typeof configTable;

export const isComplexFilter = (filter: Filter): filter is ComplexFilter => {
  return (
    typeof filter === "object" &&
    filter !== null &&
    "op" in filter &&
    "value" in filter
  );
};

export const matchesFilter = (filter: Filter, value: FieldValue): boolean => {
  if (!isComplexFilter(filter)) {
    if (filter === null || filter === undefined) return value == null;
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

export const matchesFilters = (filters: Filters, entity: Fieldset): boolean => {
  for (const [fieldKey, filter] of Object.entries(filters)) {
    if (!matchesFilter(filter, entity[fieldKey])) return false;
  }
  return true;
};

const getFieldSql = (table: EntityTable, fieldKey: string): SQL => {
  if (tableStoredFields.includes(fieldKey)) {
    const column = table[fieldKey as keyof EntityTable];
    return sql`${column}`;
  }
  return sql`json_extract(${table.fields}, ${`$.${fieldKey}`})`;
};

const buildFilterCondition = (
  table: EntityTable,
  fieldKey: string,
  filter: Filter,
): SQL | undefined => {
  const fieldSql = getFieldSql(table, fieldKey);

  if (!isComplexFilter(filter)) {
    if (filter === null || filter === undefined) {
      return sql`${fieldSql} IS NULL`;
    }
    return sql`${fieldSql} = ${filter}`;
  }

  const { op, value } = filter;

  switch (op) {
    case "eq":
      return sql`${fieldSql} = ${value}`;

    case "not":
      return sql`${fieldSql} != ${value}`;

    case "in":
      if (!Array.isArray(value)) return undefined;
      return sql`${fieldSql} IN ${value}`;

    case "notIn":
      if (!Array.isArray(value)) return undefined;
      return sql`${fieldSql} NOT IN ${value}`;

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
): SQL | undefined => {
  const conditions: SQL[] = [];

  for (const [fieldKey, filter] of Object.entries(filters)) {
    const condition = buildFilterCondition(table, fieldKey, filter);
    if (condition) conditions.push(condition);
  }

  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];

  return and(...conditions);
};
