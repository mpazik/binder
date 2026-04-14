import type { KnowledgeGraph } from "@binder/db";
import {
  type ErrorObject,
  fail,
  isErr,
  ok,
  type ResultAsync,
} from "@binder/utils";
import type { Logger } from "../log.ts";
import type { FileSystem } from "../lib/filesystem.ts";
import type { DatabaseCli } from "../db";
import type { AppConfig } from "../config.ts";
import { cleanupOrphanSnapshots, type SnapshotMode } from "../lib/snapshot.ts";
import {
  CONFIG_NAVIGATION_ITEMS,
  loadNavigation,
  renderNavigation,
} from "./navigation.ts";
import { type ViewLoader } from "./view-entity.ts";

export type RenderDocsResult = {
  modifiedPaths: string[];
  divergedPaths: string[];
};

export const renderDocs = async (services: {
  db: DatabaseCli;
  kg: KnowledgeGraph;
  fs: FileSystem;
  log: Logger;
  config: AppConfig;
  views: ViewLoader;
  force?: boolean;
}): ResultAsync<RenderDocsResult> => {
  const {
    db,
    kg,
    fs,
    log,
    views: loadViews,
    config: { paths },
    force,
  } = services;

  const mode: SnapshotMode =
    force === true ? "force" : force === false ? "verify" : "fast";

  const navigationResult = await loadNavigation(kg);
  if (isErr(navigationResult)) return navigationResult;
  const viewsResult = await loadViews();
  if (isErr(viewsResult)) return viewsResult;

  const baseCtx = { db, kg, fs, paths, log, views: viewsResult.data, mode };

  const errors: ErrorObject[] = [];

  const renderRecordResult = await renderNavigation(
    { ...baseCtx, namespace: "record" },
    navigationResult.data,
  );
  if (isErr(renderRecordResult)) return renderRecordResult;
  errors.push(...renderRecordResult.data.errors);

  const cleanupRecordResult = await cleanupOrphanSnapshots(
    db,
    fs,
    paths,
    renderRecordResult.data.renderedPaths,
    "record",
  );
  if (isErr(cleanupRecordResult)) return cleanupRecordResult;

  const renderConfigResult = await renderNavigation(
    { ...baseCtx, namespace: "config" },
    CONFIG_NAVIGATION_ITEMS,
  );
  if (isErr(renderConfigResult)) return renderConfigResult;
  errors.push(...renderConfigResult.data.errors);

  const cleanupConfigResult = await cleanupOrphanSnapshots(
    db,
    fs,
    paths,
    renderConfigResult.data.renderedPaths,
    "config",
  );
  if (isErr(cleanupConfigResult)) return cleanupConfigResult;

  if (errors.length > 0) {
    return fail(
      "render-partial",
      `Render completed with ${errors.length} error(s)`,
      { data: { errors } },
    );
  }

  log.debug("renderDocs: complete");
  return ok({
    modifiedPaths: [
      ...renderRecordResult.data.modifiedPaths,
      ...renderConfigResult.data.modifiedPaths,
    ],
    divergedPaths: [
      ...renderRecordResult.data.divergedPaths,
      ...renderConfigResult.data.divergedPaths,
    ],
  });
};
