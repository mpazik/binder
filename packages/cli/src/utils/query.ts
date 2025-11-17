import type { Fieldset, QueryParams } from "@binder/db";
import { createError, err, isErr, ok, type Result } from "@binder/utils";
import { extractFieldNames, interpolateFields } from "./interpolate-fields.ts";

export type NavigationContext = Fieldset[];

const resolvePlaceholders = (
  query: string,
  parents: NavigationContext = [],
): Result<string> => {
  const fieldNames = extractFieldNames(query);

  if (fieldNames.length === 0) return ok(query);

  const fieldset: Fieldset = {};

  for (const fieldName of fieldNames) {
    const parentMatch = fieldName.match(/^parent(\d*)\.(.+)$/);

    if (!parentMatch) {
      return err(
        createError(
          "invalid-placeholder",
          `Invalid placeholder format: {${fieldName}}`,
          { fieldName },
        ),
      );
    }

    const [, indexStr, actualFieldName] = parentMatch;
    const parentIndex = indexStr === "" ? 0 : parseInt(indexStr, 10) - 1;

    if (parentIndex >= parents.length) {
      return err(
        createError(
          "context-not-found",
          `Parent context at index ${parentIndex + 1} not found`,
          { parentIndex: parentIndex + 1, stackSize: parents.length },
        ),
      );
    }

    const parentEntity = parents[parentIndex];
    if (!parentEntity) {
      return err(
        createError(
          "context-not-found",
          `Parent entity at index ${parentIndex + 1} is undefined`,
          { parentIndex: parentIndex + 1 },
        ),
      );
    }

    const fieldValue = parentEntity[actualFieldName!];

    if (fieldValue === null || fieldValue === undefined) {
      return err(
        createError(
          "field-not-found",
          `Field '${actualFieldName}' not found in parent${indexStr || ""}`,
          {
            fieldName: actualFieldName,
            parentIndex: parentIndex + 1,
            entity: parentEntity,
          },
        ),
      );
    }

    fieldset[fieldName] = fieldValue;
  }

  return interpolateFields(query, fieldset);
};

export const parseStringQuery = (
  query: string,
  parents?: NavigationContext,
): Result<QueryParams> => {
  const resolveResult = resolvePlaceholders(query, parents);
  if (isErr(resolveResult)) return resolveResult;

  const resolvedQuery = resolveResult.data;
  const filters: Record<string, string> = {};
  const pairs = resolvedQuery.split(/\s+AND\s+|,/).map((p) => p.trim());

  for (const pair of pairs) {
    const [field, value] = pair.split("=").map((s) => s.trim());
    if (field && value) {
      filters[field] = value;
    }
  }

  return ok({ filters });
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
