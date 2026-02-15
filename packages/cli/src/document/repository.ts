import { type KnowledgeGraph } from "@binder/db";
import { isErr, ok, type ResultAsync } from "@binder/utils";
import type { Logger } from "../log.ts";
import type { FileSystem } from "../lib/filesystem.ts";
import type { DatabaseCli } from "../db";
import type { AppConfig } from "../config.ts";
import { cleanupOrphanSnapshots } from "../lib/snapshot.ts";
import {
  CONFIG_NAVIGATION_ITEMS,
  loadNavigation,
  renderNavigation,
} from "./navigation.ts";
import { type TemplateLoader, type Templates } from "./template-entity.ts";

export const renderDocs = async (services: {
  db: DatabaseCli;
  kg: KnowledgeGraph;
  fs: FileSystem;
  log: Logger;
  config: AppConfig;
  templates: TemplateLoader;
}): ResultAsync<string[]> => {
  const {
    db,
    kg,
    fs,
    log,
    templates: loadTemplates,
    config: { paths },
  } = services;

  const navigationResult = await loadNavigation(kg);
  if (isErr(navigationResult)) return navigationResult;
  const templatesResult = await loadTemplates();
  if (isErr(templatesResult)) return templatesResult;

  const renderRecordResult = await renderNavigation(
    db,
    kg,
    fs,
    paths,
    navigationResult.data,
    templatesResult.data,
    "record",
  );
  if (isErr(renderRecordResult)) return renderRecordResult;

  const cleanupRecordResult = await cleanupOrphanSnapshots(
    db,
    fs,
    paths,
    renderRecordResult.data.renderedPaths,
    "record",
  );
  if (isErr(cleanupRecordResult)) return cleanupRecordResult;

  const renderConfigResult = await renderNavigation(
    db,
    kg,
    fs,
    paths,
    CONFIG_NAVIGATION_ITEMS,
    templatesResult.data,
    "config",
  );
  if (isErr(renderConfigResult)) return renderConfigResult;

  const cleanupConfigResult = await cleanupOrphanSnapshots(
    db,
    fs,
    paths,
    renderConfigResult.data.renderedPaths,
    "config",
  );
  if (isErr(cleanupConfigResult)) return cleanupConfigResult;

  log.debug("renderDocs: complete");
  return ok([
    ...renderRecordResult.data.modifiedPaths,
    ...renderConfigResult.data.modifiedPaths,
  ]);
};
