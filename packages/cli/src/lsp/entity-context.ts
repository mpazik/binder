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
import type { NavigationItem } from "../document/navigation.ts";
import type { Logger } from "../log.ts";

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
    const interpolatedQuery = interpolateQueryParams(schema, navItem.query, [
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

export type EntityContextCache = {
  get: (
    schema: EntitySchema,
    uri: string,
    navigationItem: NavigationItem,
  ) => ResultAsync<DocumentEntityContext>;
  invalidate: (uri: string) => void;
  invalidateAll: () => void;
  getStats: () => { size: number; hits: number; misses: number };
};

export const createEntityContextCache = (
  log: Logger,
  kg: KnowledgeGraph,
): EntityContextCache => {
  const cache = new Map<string, DocumentEntityContext>();
  let hits = 0;
  let misses = 0;

  return {
    get: async (schema, uri, navigationItem) => {
      const cached = cache.get(uri);
      if (cached) {
        hits++;
        return ok(cached);
      }

      misses++;

      const filePath = uri.replace(/^file:\/\//, "");
      const contextResult = await fetchEntityContext(
        kg,
        schema,
        navigationItem,
        filePath,
      );

      if (isErr(contextResult)) return contextResult;

      cache.set(uri, contextResult.data);
      return ok(contextResult.data);
    },
    invalidate: (uri: string): void => {
      if (cache.delete(uri)) {
        log.debug("Entity context cache invalidated", { uri });
      }
    },
    invalidateAll: (): void => {
      const size = cache.size;
      if (size > 0) {
        cache.clear();
        log.debug("Entity context cache invalidated all", {
          entriesRemoved: size,
        });
      }
    },
    getStats: () => ({
      size: cache.size,
      hits,
      misses,
    }),
  };
};
