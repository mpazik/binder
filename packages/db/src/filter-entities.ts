import { and, sql, type SQL } from "drizzle-orm";
import { tableStoredFields, type nodeTable, type configTable } from "./schema";
import type { ComplexFilter, Filter, Filters } from "./model";

type EntityTable = typeof nodeTable | typeof configTable;

const isComplexFilter = (filter: Filter): filter is ComplexFilter => {
  return (
    typeof filter === "object" &&
    filter !== null &&
    "op" in filter &&
    "value" in filter
  );
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
