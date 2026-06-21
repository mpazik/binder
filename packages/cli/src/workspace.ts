import { resolve } from "node:path";
import process from "node:process";
import { fail, isErr, ok, type ResultAsync } from "@binder/utils";
import type { KnowledgeGraph } from "@binder/repo";
import { type AppConfig, findBinderRoot } from "./config.ts";
import { initializeFullRuntime, initializeMinimalRuntime } from "./runtime.ts";
import type { LogLevel } from "./log.ts";

// Minimal re-export surface so scripts importing the bundled entry don't need
// to resolve @binder/* themselves.
export { isErr, ok } from "@binder/utils";
export { createTransactionInput } from "@binder/repo";

export type OpenWorkspaceOptions = {
  cwd?: string;
  silent?: boolean;
  logLevel?: LogLevel;
  /**
   * Identifies the client (script, agent, service) opening the workspace.
   * Must be kebab-case (lowercase letters, digits, single hyphens). Used
   * verbatim as transaction provenance (the repo `source`) and as the log
   * file stem (`<clientId>.log`), so it is validated, never rewritten — an
   * invalid id fails the open.
   */
  clientId?: string;
};

// Kebab-case: clientId is used unescaped as both a log filename and tx provenance.
const CLIENT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Handle returned by {@link openWorkspace}.
 *
 * - `kg` is the repo knowledge graph. Originated writes (via `update()` /
 *   `process()`) are stamped with `clientId` as their `source` provenance.
 * - `config` is the resolved workspace configuration.
 * - `close()` is idempotent — calling it more than once is safe.
 */
export type WorkspaceHandle = {
  kg: KnowledgeGraph;
  config: AppConfig;
  close: () => Promise<void>;
};

// Resolve BINDER_WORKSPACE first, then walk up from cwd via findBinderRoot.
// options.cwd overrides the start dir.
const resolveRoot = async (cwd?: string): ResultAsync<string> => {
  const fromEnv = process.env.BINDER_WORKSPACE;
  if (fromEnv) return ok(resolve(fromEnv));

  const start = cwd ? resolve(cwd) : process.cwd();
  const found = await findBinderRoot(start);
  if (isErr(found)) return found;
  if (!found.data)
    return fail(
      "workspace-not-found",
      `No Binder workspace found by walking up from ${start}`,
      { data: { start } },
    );
  return ok(found.data);
};

export const openWorkspace = async (
  options?: OpenWorkspaceOptions,
): ResultAsync<WorkspaceHandle> => {
  const clientId = options?.clientId;
  if (clientId !== undefined && !CLIENT_ID_PATTERN.test(clientId)) {
    return fail(
      "invalid-client-id",
      `Client id "${clientId}" must be kebab-case (lowercase letters, digits, single hyphens).`,
      { data: { clientId } },
    );
  }

  const rootResult = await resolveRoot(options?.cwd);
  if (isErr(rootResult)) return rootResult;
  const root = rootResult.data;

  const minResult = await initializeMinimalRuntime({
    silent: options?.silent ?? true,
    logLevel: options?.logLevel,
  });
  if (isErr(minResult)) return minResult;

  const { runtime: minRuntime, close: closeMinimal } = minResult.data;

  // Per-client log file derived from the (validated) clientId, separate from
  // the interactive cli.log; falls back to a shared library.log when absent.
  minRuntime.logFile = clientId ? `${clientId}.log` : "library.log";

  const fullResult = await initializeFullRuntime(minRuntime, root, undefined, {
    source: clientId,
  });
  if (isErr(fullResult)) {
    closeMinimal();
    return fullResult;
  }

  const { runtime, close: closeFull } = fullResult.data;

  let closed = false;
  // Async because the repo db close is async. Idempotent via the once-guard.
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    closeFull();
    closeMinimal();
  };

  return ok({ kg: runtime.kg, config: runtime.config, close });
};
