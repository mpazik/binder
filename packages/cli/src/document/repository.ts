import { join } from "path";
import { type KnowledgeGraph } from "@binder/db";
import { isErr, ok, okVoid, type ResultAsync } from "@binder/utils";
import type { Logger } from "../log.ts";
import type { FileSystem } from "../lib/filesystem.ts";
import type { DatabaseCli } from "../db";
import type { AppConfig } from "../config.ts";
import {
  CONFIG_NAVIGATION_ITEMS,
  loadNavigation,
  type NavigationItem,
  renderNavigation,
} from "./navigation.ts";
import { SUPPORTED_SNAPSHOT_EXTS } from "./document.ts";

const removeSnapshotFiles = async (
  fs: FileSystem,
  dir: string,
): ResultAsync<void> => {
  const exists = await fs.exists(dir);
  if (!exists) return ok(undefined);

  const listResult = await fs.readdir(dir);
  if (isErr(listResult)) return listResult;

  for (const entry of listResult.data) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory) {
      const removeResult = await removeSnapshotFiles(fs, entryPath);
      if (isErr(removeResult)) return removeResult;
    } else if (
      SUPPORTED_SNAPSHOT_EXTS.some((ext) => entry.name.endsWith(ext))
    ) {
      const rmResult = await fs.rm(entryPath, { force: true });
      if (isErr(rmResult)) return rmResult;
    }
  }

  return okVoid;
};

const removeNavigationFiles = async (
  fs: FileSystem,
  items: NavigationItem[],
  baseDir: string,
): ResultAsync<void> => {
  for (const item of items) {
    const filePath = join(baseDir, item.path);
    const exists = await fs.exists(filePath);
    if (exists) {
      const rmResult = await fs.rm(filePath);
      if (isErr(rmResult)) return rmResult;
    }

    if (item.children) {
      const removeResult = await removeNavigationFiles(
        fs,
        item.children,
        baseDir,
      );
      if (isErr(removeResult)) return removeResult;
    }
  }

  return okVoid;
};

export const renderDocs = async (services: {
  db: DatabaseCli;
  kg: KnowledgeGraph;
  fs: FileSystem;
  log: Logger;
  config: AppConfig;
}): ResultAsync<void> => {
  const {
    db,
    kg,
    fs,
    log,
    config: { paths },
  } = services;

  const removeDocsResult = await removeSnapshotFiles(fs, paths.docs);
  if (isErr(removeDocsResult)) return removeDocsResult;

  const removeConfigResult = await removeNavigationFiles(
    fs,
    CONFIG_NAVIGATION_ITEMS,
    paths.binder,
  );
  if (isErr(removeConfigResult)) return removeConfigResult;

  const navigationResult = await loadNavigation(kg);
  if (isErr(navigationResult)) return navigationResult;

  const renderNodeResult = await renderNavigation(
    db,
    kg,
    fs,
    paths,
    navigationResult.data,
    "node",
  );
  if (isErr(renderNodeResult)) return renderNodeResult;

  const renderConfigResult = await renderNavigation(
    db,
    kg,
    fs,
    paths,
    CONFIG_NAVIGATION_ITEMS,
    "config",
  );
  if (isErr(renderConfigResult)) return renderConfigResult;

  return ok(undefined);
};
