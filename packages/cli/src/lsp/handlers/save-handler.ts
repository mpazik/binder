import { fileURLToPath } from "node:url";
import {
  MessageType,
  ShowMessageNotification,
} from "vscode-languageserver/node";
import { isErr, ok, tryCatch, type ResultAsync } from "@binder/utils";
import { extractFileChanges } from "../../document/change-extractor.ts";
import { loadNavigation } from "../../document/navigation.ts";
import type { RuntimeContextWithDb } from "../../runtime.ts";
import type { WorkspaceCtx, WorkspaceEntry } from "../workspace-manager.ts";
import {
  getRelativeSnapshotPath,
  getSnapshotEntityUid,
  namespaceFromSnapshotPath,
} from "../../lib/snapshot.ts";

const notify = (
  ctx: WorkspaceCtx,
  type: MessageType,
  message: string,
): void => {
  ctx.connection.sendNotification(ShowMessageNotification.type, {
    type,
    message,
  });
};

type SyncResult = { fieldChangeCount: number };

const META_KEYS = new Set(["$ref", "type", "key", "uid", "$delete"]);

const countFieldChanges = (changesets: Record<string, unknown>[]): number => {
  let count = 0;
  for (const cs of changesets) {
    const fieldKeys = Object.keys(cs).filter((k) => !META_KEYS.has(k));
    count += fieldKeys.length > 0 ? fieldKeys.length : 1; // deletes count as 1
  }
  return count;
};

const syncDocument = async (
  context: RuntimeContextWithDb,
  uri: string,
): ResultAsync<SyncResult> => {
  const { log, config, fs, kg } = context;

  if (!uri.startsWith("file:")) {
    log.warn("Ignoring non-file URI", { uri });
    return ok({ fieldChangeCount: 0 });
  }
  const absolutePath = fileURLToPath(uri);

  const namespace = namespaceFromSnapshotPath(absolutePath, config.paths);
  if (namespace === undefined) {
    log.debug("File outside workspace, skipping sync", {
      path: absolutePath,
      config: config.paths,
    });
    return ok({ fieldChangeCount: 0 });
  }
  const relativePath = getRelativeSnapshotPath(absolutePath, config.paths);
  log.info("Syncing file", { relativePath });

  const navResult = await loadNavigation(kg, namespace);
  if (isErr(navResult)) return navResult;

  const schemaResult = await kg.getSchema(namespace);
  if (isErr(schemaResult)) return schemaResult;

  const viewsResult = await context.views();
  if (isErr(viewsResult)) return viewsResult;

  const syncResult = await extractFileChanges(
    { fs, kg, config },
    navResult.data,
    schemaResult.data,
    relativePath,
    namespace,
    viewsResult.data,
    undefined,
    getSnapshotEntityUid(context.db, relativePath),
  );
  if (isErr(syncResult)) return syncResult;

  if (syncResult.data.length === 0) {
    log.info("No changes detected", { relativePath });
    return ok({ fieldChangeCount: 0 });
  }

  log.debug("Changesets to apply", { changesets: syncResult.data });

  const changesetKey = namespace === "config" ? "configs" : "records";
  const applyResult = await kg.update({
    author: config.author,
    [changesetKey]: syncResult.data,
  });
  if (isErr(applyResult)) return applyResult;

  const fieldChangeCount = countFieldChanges(
    syncResult.data as Record<string, unknown>[],
  );
  log.info("File synced successfully", { relativePath, fieldChangeCount });

  return ok({ fieldChangeCount });
};

// At most one sync runs per URI at a time. Saves arriving while a sync is
// in-flight set a pending flag; when the current sync finishes, a single
// re-sync runs with the latest disk content, preventing duplicate transactions.
type UriState = { running: boolean; pending: boolean };

const uriStates = new Map<string, UriState>();

const executeSave = async (
  ctx: WorkspaceCtx,
  context: RuntimeContextWithDb,
  uri: string,
  state: UriState,
): Promise<void> => {
  state.running = true;
  state.pending = false;

  const result = await tryCatch(() => syncDocument(context, uri));
  const syncError = isErr(result)
    ? result.error
    : isErr(result.data)
      ? result.data.error
      : undefined;

  if (syncError) {
    context.log.error("Sync failed", { uri, error: syncError });
    notify(
      ctx,
      MessageType.Error,
      `Sync failed: ${syncError.message ?? syncError.key}`,
    );
  } else if (!isErr(result) && !isErr(result.data)) {
    const { fieldChangeCount } = result.data.data;
    if (fieldChangeCount > 0) {
      const message =
        fieldChangeCount === 1
          ? "Change saved to Binder"
          : `Saved ${fieldChangeCount} changes to Binder`;
      notify(ctx, MessageType.Info, message);
    }
  }

  state.running = false;

  if (state.pending) {
    context.log.info("Re-syncing after queued save", { uri });
    void executeSave(ctx, context, uri, state);
    return;
  }

  uriStates.delete(uri);
};

// Doesn't use withDocumentContext/LspHandler because it runs its own
// extraction pipeline via extractFileChanges.
export const handleDocumentSave = async (
  ctx: WorkspaceCtx,
  event: { document: { uri: string } },
  workspace: WorkspaceEntry,
): Promise<void> => {
  const uri = event.document.uri;
  let state = uriStates.get(uri);

  if (!state) {
    state = { running: false, pending: false };
    uriStates.set(uri, state);
  }

  if (state.running) {
    workspace.runtime.log.info("Save queued, sync already in progress", {
      uri,
    });
    state.pending = true;
    return;
  }

  void executeSave(ctx, workspace.runtime, uri, state);
};
