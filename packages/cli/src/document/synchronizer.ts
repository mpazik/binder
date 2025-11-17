import { relative } from "path";
import * as fs from "node:fs";
import type {
  FieldsetNested,
  KnowledgeGraph,
  NodeRef,
  TransactionInput,
} from "@binder/db";
import { createError, err, isErr, ok, type ResultAsync } from "@binder/utils";
import type { Config } from "../bootstrap.ts";
import type { FileSystem } from "../lib/filesystem.ts";
import { diffNodeTrees } from "../utils/node-diff.ts";
import { parseMarkdown, parseView } from "./markdown.ts";
import { deconstructAstDocument, fetchDocumentNodes } from "./doc-builder.ts";
import { extractFields } from "./view.ts";
import {
  DEFAULT_DYNAMIC_VIEW,
  extractFieldsFromPath,
  loadNavigation,
} from "./navigation.ts";

export { diffNodeTrees } from "../utils/node-diff.ts";

export const parseFile = async (
  kg: KnowledgeGraph,
  config: Config,
  fs: FileSystem,
  markdown: string,
  filePath: string,
): ResultAsync<{ file: FieldsetNested; kg: FieldsetNested }> => {
  const relativePath = relative(config.paths.docs, filePath);

  const searchResult = await kg.search({
    filters: { path: relativePath },
  });
  if (isErr(searchResult)) return searchResult;

  if (searchResult.data.items.length === 0) {
    const schemaResult = await kg.getNodeSchema();
    if (isErr(schemaResult)) return schemaResult;
    const schema = schemaResult.data;

    const navigationResult = await loadNavigation(fs, config.paths.binder);
    if (isErr(navigationResult)) return navigationResult;

    const collectNavigationItems = (
      items: typeof navigationResult.data,
    ): typeof navigationResult.data => {
      const collected: typeof navigationResult.data = [];
      for (const item of items) {
        collected.push(item);
        if (item.children) {
          collected.push(...collectNavigationItems(item.children));
        }
      }
      return collected;
    };

    const allNavigationItems = collectNavigationItems(navigationResult.data);

    for (const navItem of allNavigationItems) {
      if (!navItem.query) continue;

      const pathFieldsResult = extractFieldsFromPath(
        relativePath,
        navItem.path,
      );
      if (isErr(pathFieldsResult)) continue;
      const pathFields = pathFieldsResult.data;

      const templateString = navItem.view ?? DEFAULT_DYNAMIC_VIEW;
      const viewAst = parseView(templateString);
      const markdownAst = parseMarkdown(markdown);
      const fileFieldsResult = extractFields(schema, viewAst, markdownAst);
      if (isErr(fileFieldsResult)) return fileFieldsResult;

      const kgSearchResult = await kg.search({
        filters: pathFields as Record<string, string>,
      });
      if (isErr(kgSearchResult)) return kgSearchResult;

      if (kgSearchResult.data.items.length !== 1) {
        return err(
          createError(
            "invalid_node_count",
            "Path fields must resolve to exactly one node",
            {
              pathFields,
              nodeCount: kgSearchResult.data.items.length,
            },
          ),
        );
      }

      return ok({
        file: fileFieldsResult.data,
        kg: kgSearchResult.data.items[0]!,
      });
    }

    return err(
      createError(
        "document_not_found",
        "Document not found in knowledge graph or navigation config",
        { path: relativePath },
      ),
    );
  }

  const documentRef = searchResult.data.items[0]?.uid as NodeRef;
  if (!documentRef) {
    return err(
      createError("document_uid_missing", "Document found but has no uid", {
        path: relativePath,
      }),
    );
  }

  const ast = parseMarkdown(markdown);

  const schemaResult = await kg.getNodeSchema();
  if (isErr(schemaResult)) return schemaResult;
  const schema = schemaResult.data;

  const fileRepresentationResult = deconstructAstDocument(schema, ast);
  if (isErr(fileRepresentationResult)) return fileRepresentationResult;

  const kgRepresentationResult = await fetchDocumentNodes(kg, documentRef);
  if (isErr(kgRepresentationResult)) return kgRepresentationResult;

  return ok({
    file: fileRepresentationResult.data,
    kg: kgRepresentationResult.data,
  });
};

export const synchronizeFile = async (
  kg: KnowledgeGraph,
  config: Config,
  fs: FileSystem,
  markdown: string,
  filePath: string,
): ResultAsync<TransactionInput | null> => {
  const parseResult = await parseFile(kg, config, fs, markdown, filePath);
  if (isErr(parseResult)) return parseResult;

  const diffResult = diffNodeTrees(parseResult.data.file, parseResult.data.kg);
  if (isErr(diffResult)) return diffResult;

  if (diffResult.data.length === 0) {
    return ok(null);
  }

  return ok({
    author: config.author,
    nodes: diffResult.data,
  });
};
