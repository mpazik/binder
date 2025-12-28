import { isErr, ok, type ResultAsync } from "@binder/utils";
import { synchronizeFile } from "../document/synchronizer.ts";
import { loadNavigation } from "../document/navigation.ts";
import type { RuntimeContextWithDb } from "../runtime.ts";
import {
  getRelativeSnapshotPath,
  namespaceFromSnapshotPath,
} from "../lib/snapshot.ts";

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

  const namespace = namespaceFromSnapshotPath(absolutePath, config.paths);
  if (namespace === undefined) {
    log.debug("File outside workspace, skipping sync", {
      path: absolutePath,
      config: config.paths,
    });
    return ok(undefined);
  }
  const relativePath = getRelativeSnapshotPath(absolutePath, config.paths);

  const navResult = await loadNavigation(kg, namespace);
  if (isErr(navResult)) return navResult;

  const schemaResult = await kg.getSchema(namespace);
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

  if (syncResult.data.length === 0) {
    log.debug("No changes to sync", { relativePath });
    return ok(undefined);
  }

  const transactionInput =
    namespace === "config"
      ? { author: config.author, configs: syncResult.data }
      : { author: config.author, nodes: syncResult.data };

  const applyResult = await kg.update(transactionInput);
  if (isErr(applyResult)) return applyResult;

  log.info("File synced successfully", {
    relativePath,
    changeCount: syncResult.data.length,
  });

  return ok(undefined);
};
