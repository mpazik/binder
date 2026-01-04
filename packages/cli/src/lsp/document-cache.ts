import { fileURLToPath } from "node:url";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { Logger } from "../log.ts";
import {
  getDocumentFileType,
  parseDocument,
  type ParsedDocument,
} from "../document/document.ts";

type CacheKey = string;
type CacheEntry = {
  version: number;
  parsed: ParsedDocument;
};

export type DocumentCache = {
  getParsed: (document: TextDocument) => ParsedDocument | undefined;
  invalidate: (uri: string) => void;
  getStats: () => { size: number; hits: number; misses: number };
};

const makeCacheKey = (uri: string, version: number): CacheKey =>
  `${uri}:${version}`;

export const createDocumentCache = (log: Logger): DocumentCache => {
  const cache = new Map<CacheKey, CacheEntry>();
  let hits = 0;
  let misses = 0;

  const getParsed = (document: TextDocument): ParsedDocument | undefined => {
    const uri = document.uri;
    const version = document.version;
    const key = makeCacheKey(uri, version);

    const cached = cache.get(key);
    if (cached) {
      hits++;
      return cached.parsed;
    }

    const filePath = fileURLToPath(uri);
    const type = getDocumentFileType(filePath);

    if (!type) {
      log.debug("Document type not supported for caching", { uri, filePath });
      return undefined;
    }

    misses++;

    const text = document.getText();
    const parsed = parseDocument(text, type);

    cache.set(key, { version, parsed });
    return parsed;
  };

  const invalidate = (uri: string): void => {
    const keysToDelete: CacheKey[] = [];
    for (const key of cache.keys()) {
      if (key.startsWith(`${uri}:`)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      cache.delete(key);
    }

    if (keysToDelete.length > 0) {
      log.debug("Document cache invalidated", {
        uri,
        entriesRemoved: keysToDelete.length,
        cacheSize: cache.size,
      });
    }
  };

  const getStats = () => ({
    size: cache.size,
    hits,
    misses,
  });

  return {
    getParsed,
    invalidate,
    getStats,
  };
};
