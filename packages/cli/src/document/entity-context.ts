import type {
  EntitySchema,
  EntityType,
  Fieldset,
  FieldsetNested,
  Filters,
  KnowledgeGraph,
  QueryParams,
} from "@binder/db";
import { isErr, ok, type ResultAsync } from "@binder/utils";
import { extractFieldValues } from "../utils/interpolate-fields.ts";
import { getTypeFromFilters, interpolateQueryParams } from "../utils/query.ts";
import type { NavigationItem } from "./navigation.ts";

export type DocumentEntityContext =
  | { kind: "single"; entities: FieldsetNested[] }
  | { kind: "list"; entities: FieldsetNested[]; queryType?: EntityType }
  | { kind: "document"; entities: FieldsetNested[] };

const fetchSingleContext = async (
  kg: KnowledgeGraph,
  pathFields: Fieldset,
): ResultAsync<FieldsetNested[]> => {
  const searchResult = await kg.search({
    filters: pathFields as unknown as Filters,
  });
  if (isErr(searchResult)) return ok([]);
  return ok(searchResult.data.items);
};

const fetchListContext = async (
  kg: KnowledgeGraph,
  query: QueryParams,
): ResultAsync<FieldsetNested[]> => {
  const searchResult = await kg.search(query);
  if (isErr(searchResult)) return ok([]);
  return ok(searchResult.data.items);
};

export const fetchEntityContext = async (
  kg: KnowledgeGraph,
  schema: EntitySchema,
  navItem: NavigationItem,
  filePath: string,
): ResultAsync<DocumentEntityContext> => {
  const pathFieldsResult = extractFieldValues(navItem.path, filePath);
  const pathFields = isErr(pathFieldsResult) ? {} : pathFieldsResult.data;

  if (navItem.includes) {
    const entities = await fetchSingleContext(kg, pathFields);
    if (isErr(entities)) return entities;
    return ok({ kind: "single", entities: entities.data });
  }

  if (navItem.query) {
    const interpolatedQuery = interpolateQueryParams(navItem.query, [
      pathFields,
    ]);
    const query = isErr(interpolatedQuery)
      ? navItem.query
      : interpolatedQuery.data;

    const queryType = query.filters
      ? getTypeFromFilters(query.filters)
      : undefined;

    const entities = await fetchListContext(kg, query);
    if (isErr(entities)) return entities;
    return ok({
      kind: "list",
      entities: entities.data,
      queryType,
    });
  }

  const entities = await fetchSingleContext(kg, pathFields);
  if (isErr(entities)) return entities;
  return ok({ kind: "document", entities: entities.data });
};
