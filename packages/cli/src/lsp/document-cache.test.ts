import { beforeEach, describe, expect, it } from "bun:test";
import { TextDocument } from "vscode-languageserver-textdocument";
import { mockLog } from "../runtime.mock.ts";
import { createDocumentCache, type DocumentCache } from "./document-cache.ts";

const yamlDocV1 = TextDocument.create(
  "file:///test.yaml",
  "yaml",
  1,
  "type: Task",
);
const yamlDocV2 = TextDocument.create(
  "file:///test.yaml",
  "yaml",
  2,
  "type: Task\ntitle: Updated",
);
const unsupportedDoc = TextDocument.create(
  "file:///test.txt",
  "plaintext",
  1,
  "text",
);

describe("document-cache", () => {
  let cache: DocumentCache;

  beforeEach(() => {
    cache = createDocumentCache(mockLog);
  });

  const checkStats = (expected: {
    size: number;
    hits: number;
    misses: number;
  }) => {
    expect(cache.getStats()).toEqual(expected);
  };

  it("caches parsed document on first access", () => {
    const parsed = cache.getParsed(yamlDocV1);

    expect(parsed).toBeDefined();
    checkStats({ size: 1, hits: 0, misses: 1 });
  });

  it("returns cached document on second access with same version", () => {
    const parsed1 = cache.getParsed(yamlDocV1);
    const parsed2 = cache.getParsed(yamlDocV1);

    expect(parsed1).toBe(parsed2);
    checkStats({ size: 1, hits: 1, misses: 1 });
  });

  it("parses again when document version changes", () => {
    const parsed1 = cache.getParsed(yamlDocV1);
    const parsed2 = cache.getParsed(yamlDocV2);

    expect(parsed1).not.toBe(parsed2);
    checkStats({ size: 2, hits: 0, misses: 2 });
  });

  it("invalidates all versions of a document", () => {
    cache.getParsed(yamlDocV1);
    cache.getParsed(yamlDocV2);
    checkStats({ size: 2, hits: 0, misses: 2 });

    cache.invalidate("file:///test.yaml");
    checkStats({ size: 0, hits: 0, misses: 2 });
  });

  it("returns undefined for unsupported file types", () => {
    const parsed = cache.getParsed(unsupportedDoc);

    expect(parsed).toBeUndefined();
    checkStats({ size: 0, hits: 0, misses: 0 });
  });

  it("tracks hits and misses separately", () => {
    cache.getParsed(yamlDocV1);
    cache.getParsed(yamlDocV1);
    cache.getParsed(yamlDocV1);

    checkStats({ size: 1, hits: 2, misses: 1 });
  });
});
