import type { EntitySchema, KnowledgeGraph } from "@binder/db";
import { isErr, ok, type ResultAsync } from "@binder/utils";
import type { Logger } from "../log.ts";
import type { NavigationItem } from "../document/navigation.ts";
import {
  fetchEntityContext,
  type DocumentEntityContext,
} from "../document/entity-context.ts";

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
