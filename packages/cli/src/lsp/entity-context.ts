import type {
  EntitySchema,
  EntityType,
  Fieldset,
  FieldsetNested,
  Filters,
  KnowledgeGraph,
  QueryParams,
} from "@binder/db";
import { isErr, ok, resultFallback, type ResultAsync } from "@binder/utils";
import { extractFieldValues } from "../utils/interpolate-fields.ts";
import { getTypeFromFilters, interpolateQueryParams } from "../utils/query.ts";
import type { NavigationItem } from "../document/navigation.ts";
import type { DatabaseCli } from "../db";
import { getSnapshotEntityUid } from "../lib/snapshot.ts";
import type { RuntimeContextWithDb } from "../runtime.ts";

export type DocumentEntityContext =
  | { kind: "single"; entities: FieldsetNested[] }
  | { kind: "list"; entities: FieldsetNested[]; queryType?: EntityType }
  | { kind: "document"; entities: FieldsetNested[] };

const searchEntities = async (
  kg: KnowledgeGraph,
  query: QueryParams,
): ResultAsync<FieldsetNested[]> => {
  const searchResult = await kg.search(query);
  if (isErr(searchResult)) return ok([]);
  return ok(searchResult.data.items);
};

export const extractUidFromContent = (content: string): string | undefined => {
  const match = content.match(/^uid:\s*(\S+)/m);
  return match?.[1];
};

// Three-tier entity resolution: snapshot uid → path field extraction → content uid fallback.
// List-style navigation items (with `query`) use the query directly; content uid fallback is skipped.
export const fetchEntityContext = async (
  kg: KnowledgeGraph,
  db: DatabaseCli,
  schema: EntitySchema,
  navItem: NavigationItem,
  filePath: string,
  content?: string,
): ResultAsync<DocumentEntityContext> => {
  const snapshotUid = getSnapshotEntityUid(db, filePath);
  const pathFields: Fieldset = snapshotUid
    ? { uid: snapshotUid }
    : resultFallback(extractFieldValues(navItem.path, filePath), {});

  if (navItem.query) {
    const query = resultFallback(
      interpolateQueryParams(schema, navItem.query, [pathFields]),
      navItem.query,
    );

    const queryType = query.filters
      ? getTypeFromFilters(query.filters)
      : undefined;

    const entities = await searchEntities(kg, query);
    if (isErr(entities)) return entities;
    return ok({
      kind: "list",
      entities: entities.data,
      queryType,
    });
  }

  let entities = await searchEntities(kg, {
    filters: pathFields as unknown as Filters,
  });
  if (isErr(entities)) return entities;

  if (entities.data.length === 0 && !snapshotUid && content) {
    const contentUid = extractUidFromContent(content);
    if (contentUid) {
      const fallback = await searchEntities(kg, {
        filters: { uid: contentUid } as unknown as Filters,
      });
      if (!isErr(fallback) && fallback.data.length > 0) {
        entities = fallback;
      }
    }
  }

  const kind = navItem.includes ? "single" : "document";
  return ok({ kind, entities: entities.data });
};

export type EntityContextCache = {
  get: (
    schema: EntitySchema,
    uri: string,
    navigationItem: NavigationItem,
    content?: string,
  ) => ResultAsync<DocumentEntityContext>;
  invalidate: (uri: string) => void;
  invalidateAll: () => void;
  getStats: () => { size: number; hits: number; misses: number };
};

export type EntityContextCacheCtx = Pick<
  RuntimeContextWithDb,
  "log" | "kg" | "db"
>;

export const createEntityContextCache = (
  ctx: EntityContextCacheCtx,
): EntityContextCache => {
  const { log, kg, db } = ctx;
  const cache = new Map<string, DocumentEntityContext>();
  let hits = 0;
  let misses = 0;

  return {
    get: async (schema, uri, navigationItem, content) => {
      const cached = cache.get(uri);
      if (cached) {
        hits++;
        return ok(cached);
      }

      misses++;

      const filePath = uri.replace(/^file:\/\//, "");
      const contextResult = await fetchEntityContext(
        kg,
        db,
        schema,
        navigationItem,
        filePath,
        content,
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
