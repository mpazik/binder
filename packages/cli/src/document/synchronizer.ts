import { relative } from "path";
import type {
  FieldsetNested,
  KnowledgeGraph,
  NodeRef,
  TransactionInput,
} from "@binder/db";
import { createError, err, isErr, ok, type ResultAsync } from "@binder/utils";
import type { Config } from "../bootstrap.ts";
import { parseMarkdown } from "./markdown.ts";
import {
  DEFAULT_DYNAMIC_TEMPLATE_STRING,
  extractFieldsFromRendered,
} from "./template.ts";
import { extractFieldsFromPath } from "./dynamic-dir.ts";
import { deconstructAstDocument, fetchDocumentNodes } from "./doc-builder.ts";
import { diffNodeTrees } from "./tree-diff.ts";

export { diffNodeTrees } from "./tree-diff.ts";

export const parseFile = async (
  markdown: string,
  filePath: string,
  config: Config,
  kg: KnowledgeGraph,
): ResultAsync<{ file: FieldsetNested; kg: FieldsetNested }> => {
  const relativePath = relative(config.paths.docs, filePath);

  const searchResult = await kg.search({
    filters: { path: relativePath },
  });
  if (isErr(searchResult)) return searchResult;

  if (searchResult.data.items.length === 0) {
    for (const dynamicDir of config.dynamicDirectories) {
      const pathFieldsResult = extractFieldsFromPath(
        relativePath,
        dynamicDir.path,
      );
      if (isErr(pathFieldsResult)) continue;
      const pathFields = pathFieldsResult.data;

      const fileFieldsResult = extractFieldsFromRendered(
        dynamicDir.template ?? DEFAULT_DYNAMIC_TEMPLATE_STRING,
        markdown,
      );
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
        "Document not found in knowledge graph or dynamic directories",
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

  const astResult = parseMarkdown(markdown);
  if (isErr(astResult)) return astResult;

  const fileRepresentationResult = deconstructAstDocument(astResult.data);
  if (isErr(fileRepresentationResult)) return fileRepresentationResult;

  const kgRepresentationResult = await fetchDocumentNodes(kg, documentRef);
  if (isErr(kgRepresentationResult)) return kgRepresentationResult;

  return ok({
    file: fileRepresentationResult.data,
    kg: kgRepresentationResult.data,
  });
};

export const synchronizeFile = async (
  markdown: string,
  filePath: string,
  config: Config,
  kg: KnowledgeGraph,
): ResultAsync<TransactionInput | null> => {
  const parseResult = await parseFile(markdown, filePath, config, kg);
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
