import { isErr, ok, type ResultAsync } from "@binder/utils";
import { synchronizeFile } from "../document/synchronizer.ts";
import {
  loadNavigation,
  CONFIG_NAVIGATION_ITEMS,
} from "../document/navigation.ts";
import type { RuntimeContextWithDb } from "../runtime.ts";

export const handleDocumentSave = async (
  context: RuntimeContextWithDb,
  uri: string,
): ResultAsync<void> => {
  const { log, config, fs, kg } = context;

  const uriObj = new URL(uri);
  if (uriObj.protocol !== "file:") {
    log.warn("Ignoring non-file URI", { uri });
    return ok(undefined);
  }

  const absolutePath = uriObj.pathname;

  if (
    !absolutePath.startsWith(config.paths.docs) &&
    !absolutePath.startsWith(config.paths.binder)
  ) {
    log.debug("File outside workspace, skipping sync", { path: absolutePath });
    return ok(undefined);
  }

  const isConfig = absolutePath.startsWith(config.paths.binder);
  const namespace = isConfig ? "config" : "node";
  const basePath = isConfig ? config.paths.binder : config.paths.docs;
  const relativePath = absolutePath.slice(basePath.length + 1);

  log.debug("Syncing file", { relativePath, namespace });

  const navResult = isConfig
    ? ok(CONFIG_NAVIGATION_ITEMS)
    : await loadNavigation(fs, config.paths.binder);

  if (isErr(navResult)) return navResult;

  const schemaResult = await kg.getNodeSchema();
  if (isErr(schemaResult)) return schemaResult;

  const syncResult = await synchronizeFile(
    fs,
    kg,
    config,
    navResult.data,
    schemaResult.data,
    relativePath,
    namespace,
  );
  if (isErr(syncResult)) return syncResult;

  if (syncResult.data === null) {
    log.debug("No changes to sync", { relativePath });
    return ok(undefined);
  }

  const applyResult = await kg.update(syncResult.data);
  if (isErr(applyResult)) return applyResult;

  log.info("File synced successfully", {
    relativePath,
    nodeCount: syncResult.data.nodes?.length ?? 0,
  });

  return ok(undefined);
};
