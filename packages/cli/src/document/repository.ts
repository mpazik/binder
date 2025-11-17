import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { type KnowledgeGraph, type NodeUid } from "@binder/db";
import { isErr, ok, type ResultAsync, tryCatch } from "@binder/utils";
import type { Logger } from "../log.ts";
import type { FileSystem } from "../lib/filesystem.ts";
import type { DatabaseCli } from "../db";
import type { Config } from "../bootstrap.ts";
import {
  loadNavigation,
  renderNavigation,
  SUPPORTED_SNAPSHOT_EXTS,
} from "./navigation.ts";
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

const removeSnapshotFiles = (dir: string): void => {
  if (!existsSync(dir)) return;

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      removeSnapshotFiles(fullPath);
    } else if (
      entry.isFile() &&
      SUPPORTED_SNAPSHOT_EXTS.some((ext) => entry.name.endsWith(ext))
    ) {
      rmSync(fullPath);
    }
  }
};

export const renderDocs = async (services: {
  db: DatabaseCli;
  kg: KnowledgeGraph;
  fs: FileSystem;
  log: Logger;
  config: Config;
}): ResultAsync<void> => {
  const {
    db,
    kg,
    fs,
    log,
    config: { paths },
  } = services;
  const removeResult = tryCatch(() => {
    removeSnapshotFiles(paths.docs);
    mkdirSync(paths.docs, { recursive: true });
  });
  if (isErr(removeResult)) return removeResult;

  const docsResult = await fetchDocumentsWithPath(kg);
  if (isErr(docsResult)) return docsResult;

  const docs = docsResult.data;

  for (const doc of docs) {
    const astResult = await buildAstDoc(kg, doc.uid);
    if (isErr(astResult)) {
      log.error(`Failed to build AST for ${doc.path}`, {
        error: astResult.error,
      });
      continue;
    }

    const markdown = renderAstToMarkdown(astResult.data);
    const filePath = join(paths.docs, doc.path);

    const writeResult = tryCatch(() => {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, markdown, "utf-8");
    });

    if (isErr(writeResult)) {
      log.error(`Failed to write ${filePath}`, { error: writeResult.error });
    }
  }

  const navigationResult = await loadNavigation(fs, paths.binder);
  if (isErr(navigationResult)) return navigationResult;

  return renderNavigation(db, kg, fs, paths.docs, navigationResult.data);
};
