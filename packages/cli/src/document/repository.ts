import { mkdirSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import type { KnowledgeGraph, NodeUid } from "@binder/db";
import {
  errorToObject,
  isErr,
  ok,
  type ResultAsync,
  tryCatch,
} from "@binder/utils";
import { Log } from "../log.ts";
import { buildAstDoc } from "./doc-builder.ts";
import { renderAstToMarkdown } from "./markdown.ts";

export type DocumentWithPath = {
  uid: NodeUid;
  key?: string;
  title?: string;
  path: string;
};
const fetchDocumentsWithPath = async (
  kg: KnowledgeGraph,
): ResultAsync<DocumentWithPath[]> => {
  const searchResult = await kg.search({
    filters: { type: "Document" },
  });

  if (isErr(searchResult)) return searchResult;

  const docsWithPath = searchResult.data.items
    .filter((doc) => doc.path !== undefined && doc.path !== null)
    .map((doc) => ({
      uid: doc.uid as NodeUid,
      key: doc.key as string | undefined,
      title: doc.title as string | undefined,
      path: doc.path as string,
    }));

  return ok(docsWithPath);
};

export const renderDocs = async (
  kg: KnowledgeGraph,
  docsPath: string,
): ResultAsync<undefined> => {
  const removeResult = tryCatch(() => {
    rmSync(docsPath, { recursive: true, force: true });
    mkdirSync(docsPath, { recursive: true });
  }, errorToObject);
  if (isErr(removeResult)) return removeResult;

  const docsResult = await fetchDocumentsWithPath(kg);
  if (isErr(docsResult)) return docsResult;

  const docs = docsResult.data;

  for (const doc of docs) {
    const astResult = await buildAstDoc(kg, doc.uid);
    if (isErr(astResult)) {
      Log.error(`Failed to build AST for ${doc.path}`, {
        error: astResult.error,
      });
      continue;
    }

    const markdown = renderAstToMarkdown(astResult.data);
    const filePath = join(docsPath, doc.path);

    const writeResult = tryCatch(() => {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, markdown, "utf-8");
    }, errorToObject);

    if (isErr(writeResult)) {
      Log.error(`Failed to write ${filePath}`, { error: writeResult.error });
    }
  }

  return ok(undefined);
};
