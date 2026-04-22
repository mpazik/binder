import { fail, includes, isErr, ok, type ResultAsync } from "@binder/utils";
import { and, asc, desc, or, sql, type SQL } from "drizzle-orm";
import {
  type configTable,
  type recordTable,
  tableStoredFields,
} from "./schema";
import type { DbTransaction } from "./db.ts";
import { resolveEntityRefs } from "./entity-store.ts";
import type {
  ComplexFilter,
  EntityRef,
  EntitySchema,
  FieldDef,
  Fieldset,
  FieldValue,
  Filter,
  Filters,
  NamespaceEditable,
  OrderBy,
} from "./model";

type EntityTable = typeof recordTable | typeof configTable;

export const isComplexFilter = (filter: Filter): filter is ComplexFilter =>
  typeof filter === "object" &&
  filter !== null &&
  "op" in filter &&
  "value" in filter;

type NormalizedFilter = ComplexFilter | string | number | boolean;

export const normalizeFilter = (filter: Filter): NormalizedFilter =>
  Array.isArray(filter)
    ? { op: "in", value: filter }
    : (filter as NormalizedFilter);

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
    case "match":
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

const textSearchDataTypes = new Set(["plaintext", "richtext"]);
const textSearchExcludedFields = new Set(["id", "uid", "type", "tags"]);

export const getSearchableFields = (schema: EntitySchema): FieldDef[] =>
  Object.values(schema.fields).filter(
    (f) =>
      textSearchDataTypes.has(f.dataType) &&
      !textSearchExcludedFields.has(f.key),
  );

const matchesTextSearch = (
  text: string,
  entity: Fieldset,
  schema: EntitySchema,
): boolean => {
  const lowerText = text.toLowerCase();
  const fields = getSearchableFields(schema);
  for (const field of fields) {
    const value = entity[field.key];
    if (typeof value === "string" && value.toLowerCase().includes(lowerText)) {
      return true;
    }
    if (field.allowMultiple && Array.isArray(value)) {
      for (const item of value) {
        if (
          typeof item === "string" &&
          item.toLowerCase().includes(lowerText)
        ) {
          return true;
        }
      }
    }
  }
  return false;
};

export const matchesFilters = (
  filters: Filters,
  entity: Fieldset,
  schema?: EntitySchema,
): boolean => {
  for (const [fieldKey, filter] of Object.entries(filters)) {
    if (fieldKey === "$text") {
      if (
        typeof filter === "string" &&
        schema &&
        !matchesTextSearch(filter, entity, schema)
      )
        return false;
      continue;
    }
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
  schema: EntitySchema,
): SQL | undefined => {
  const fieldSql = getFieldSql(table, fieldKey);
  const normalized = normalizeFilter(filter);
  const fieldDef = schema.fields[fieldKey];
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

    case "match":
    case "contains":
      if (typeof value !== "string") return undefined;
      return sql`${fieldSql} LIKE ${"%" + value + "%"}`;

    case "notContains":
      if (typeof value !== "string") return undefined;
      return sql`${fieldSql} NOT LIKE ${"%" + value + "%"}`;

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

const buildTextSearchCondition = (
  table: EntityTable,
  text: string,
  schema: EntitySchema,
): SQL | undefined => {
  const searchableFields = getSearchableFields(schema);

  if (searchableFields.length === 0) return undefined;

  const pattern = `%${text}%`;
  const likeClauses = searchableFields.map((field) => {
    const fieldSql = getFieldSql(table, field.key);
    if (field.allowMultiple) {
      return sql`EXISTS (SELECT 1 FROM json_each(${fieldSql}) WHERE value LIKE ${pattern})`;
    }
    return sql`${fieldSql} LIKE ${pattern}`;
  });

  if (likeClauses.length === 1) return likeClauses[0];
  return or(...likeClauses);
};

const relationFilterOps = new Set(["eq", "not", "in", "notIn"]);

const isRefLike = (value: unknown): value is EntityRef =>
  typeof value === "string" || typeof value === "number";

const refMapKey = (ref: EntityRef): string => `${typeof ref}:${String(ref)}`;

const collectRelationFilterRefs = (filter: Filter): EntityRef[] => {
  if (isRefLike(filter)) return [filter];
  if (Array.isArray(filter)) return filter.filter(isRefLike);
  if (typeof filter !== "object" || filter === null) return [];
  if (!relationFilterOps.has(filter.op)) return [];

  if (filter.op === "in" || filter.op === "notIn") {
    if (!Array.isArray(filter.value)) return [];
    return filter.value.filter(isRefLike);
  }

  return isRefLike(filter.value) ? [filter.value] : [];
};

const normalizeRelationFilter = (
  filter: Filter,
  resolvedRefMap: Map<string, string>,
): Filter => {
  const resolveRef = (ref: EntityRef): string =>
    resolvedRefMap.get(refMapKey(ref)) ?? String(ref);

  const resolveFilterValue = (value: string | number): string | number =>
    isRefLike(value) ? resolveRef(value) : value;

  if (isRefLike(filter)) return resolveRef(filter);

  if (Array.isArray(filter))
    return filter.map(resolveFilterValue) as (string | number)[];

  if (typeof filter !== "object" || filter === null) return filter;
  if (!relationFilterOps.has(filter.op)) return filter;

  if (
    (filter.op === "in" || filter.op === "notIn") &&
    Array.isArray(filter.value)
  ) {
    return {
      ...filter,
      value: filter.value.map(resolveFilterValue) as (string | number)[],
    };
  }

  if (isRefLike(filter.value)) {
    return { ...filter, value: resolveRef(filter.value) };
  }

  return filter;
};

export const normalizeRelationFilters = async (
  tx: DbTransaction,
  namespace: NamespaceEditable,
  filters: Filters,
  schema: EntitySchema,
): ResultAsync<Filters> => {
  if (namespace !== "record") return ok(filters);

  const refsWithField: { ref: EntityRef; fieldKey: string }[] = [];
  for (const [fieldKey, filter] of Object.entries(filters)) {
    if (fieldKey === "$text") continue;
    if (schema.fields[fieldKey]?.dataType !== "relation") continue;
    for (const ref of collectRelationFilterRefs(filter as Filter)) {
      refsWithField.push({ ref, fieldKey });
    }
  }

  if (refsWithField.length === 0) return ok(filters);

  const refsToResolve = refsWithField.map((r) => r.ref);
  const resolvedResult = await resolveEntityRefs(tx, "record", refsToResolve);
  if (isErr(resolvedResult)) {
    const inner = resolvedResult.error;
    const failing = refsWithField.find(({ ref }) => {
      const refStr = String(ref);
      return inner.message?.includes(refStr);
    });
    const fieldHint = failing
      ? `Filter field '${failing.fieldKey}': record '${failing.ref}' not found`
      : inner.message;
    return fail("invalid-filter-value", fieldHint, inner.data);
  }

  const resolvedRefMap = new Map<string, string>();
  for (let i = 0; i < refsToResolve.length; i++) {
    const originalRef = refsToResolve[i]!;
    const resolvedRef = resolvedResult.data[i]!;
    resolvedRefMap.set(refMapKey(originalRef), resolvedRef);
  }

  const normalizedFilters: Filters = {};
  for (const [fieldKey, filter] of Object.entries(filters)) {
    if (fieldKey === "$text") {
      normalizedFilters[fieldKey] = filter;
      continue;
    }

    if (schema.fields[fieldKey]?.dataType !== "relation") {
      normalizedFilters[fieldKey] = filter;
      continue;
    }

    normalizedFilters[fieldKey] = normalizeRelationFilter(
      filter as Filter,
      resolvedRefMap,
    );
  }

  return ok(normalizedFilters);
};

export const buildWhereClause = (
  table: EntityTable,
  filters: Filters,
  schema: EntitySchema,
): SQL | undefined => {
  const conditions: SQL[] = [];

  for (const [fieldKey, filter] of Object.entries(filters)) {
    if (fieldKey === "$text") {
      if (typeof filter === "string") {
        const textCondition = buildTextSearchCondition(table, filter, schema);
        if (textCondition) conditions.push(textCondition);
      }
      continue;
    }
    const condition = buildFilterCondition(table, fieldKey, filter, schema);
    if (condition) conditions.push(condition);
  }

  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];

  return and(...conditions);
};

export const buildOrderByClause = (
  table: EntityTable,
  orderBy: OrderBy,
): SQL[] =>
  orderBy.map((field) => {
    const descending = field.startsWith("!");
    const fieldKey = descending ? field.slice(1) : field;
    const fieldSql = getFieldSql(table, fieldKey);
    return descending ? desc(fieldSql) : asc(fieldSql);
  });
