import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { createUid } from "@binder/db";
import { isErr, tryCatch } from "@binder/utils";
import { BINDER_VERSION } from "./environment.ts";
import { getGlobalStatePath } from "./config.ts";

const USAGE_FILE = "usage.jsonl";
const IDENTITY_FILE = "identity";
const FLUSH_SUFFIX = ".flush";

const isDebug = process.env.BINDER_TELEMETRY_DEBUG === "1";

const debugLog = (msg: string): void => {
  if (isDebug) process.stderr.write(`[telemetry-flush] ${msg}\n`);
};

const runtimeName = process.versions.bun ? "bun" : "node";
const runtimeVersion = process.versions.bun ?? process.versions.node;

const platformToOs = (platform: string): string => {
  switch (platform) {
    case "darwin":
      return "macOS";
    case "win32":
      return "Windows";
    case "linux":
      return "Linux";
    default:
      return platform;
  }
};

type StoredEvent = {
  timestamp: number;
  event: string;
  [key: string]: unknown;
};

const parseLine = (line: string): StoredEvent | undefined => {
  const result = tryCatch(() => JSON.parse(line) as StoredEvent);
  if (isErr(result)) return undefined;

  const parsed = result.data;
  if (typeof parsed !== "object" || parsed === null) return undefined;
  if (typeof parsed.event !== "string") return undefined;
  if (typeof parsed.timestamp !== "number") return undefined;

  return parsed;
};

const getOrCreateIdentity = async (statePath: string): Promise<string> => {
  const identityPath = join(statePath, IDENTITY_FILE);

  const readResult = await tryCatch(() => readFile(identityPath, "utf-8"));
  if (!isErr(readResult)) {
    const existing = readResult.data.trim();
    if (existing.length > 0) return existing;
  }

  const identity = createUid(8, "brd");
  await mkdir(statePath, { recursive: true });
  await writeFile(identityPath, identity, "utf-8");
  return identity;
};

const parseEventsFromRaw = (raw: string): StoredEvent[] =>
  raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(parseLine)
    .filter((e): e is StoredEvent => e !== undefined);

type PendingFile = { path: string; events: StoredEvent[] };

/** Read a `.flush` file, parse its events, and drop it if empty/unreadable. */
const loadFlushFile = async (path: string): Promise<PendingFile | null> => {
  const readResult = await tryCatch(() => readFile(path, "utf-8"));
  if (isErr(readResult)) {
    debugLog(`unreadable ${path}: ${readResult.error.message}`);
    return null;
  }

  const raw = readResult.data;
  if (!raw.trim()) {
    await rm(path, { force: true }).catch(() => {});
    return null;
  }

  const events = parseEventsFromRaw(raw);
  if (events.length === 0) {
    await rm(path, { force: true }).catch(() => {});
    return null;
  }

  return { path, events };
};

const findOrphanFlushFiles = async (statePath: string): Promise<string[]> => {
  const entriesResult = await tryCatch(() => readdir(statePath));
  if (isErr(entriesResult)) return [];

  const prefix = `${USAGE_FILE}.`;
  return entriesResult.data
    .filter((name) => name.startsWith(prefix) && name.endsWith(FLUSH_SUFFIX))
    .map((name) => join(statePath, name));
};

const flush = async (): Promise<void> => {
  const key = process.env.BINDER_TELEMETRY_KEY;
  if (!key) return;

  const host = process.env.BINDER_TELEMETRY_HOST ?? "https://us.i.posthog.com";
  const statePath = getGlobalStatePath();
  const usagePath = join(statePath, USAGE_FILE);

  const orphans = await findOrphanFlushFiles(statePath);
  const rotatedPath = `${usagePath}.${process.pid}.${Date.now()}${FLUSH_SUFFIX}`;
  const rotateResult = await tryCatch(() => rename(usagePath, rotatedPath));
  const rotated = !isErr(rotateResult);

  const candidates = rotated ? [...orphans, rotatedPath] : orphans;
  if (candidates.length === 0) return;

  const pending: PendingFile[] = [];
  for (const path of candidates) {
    const loaded = await loadFlushFile(path);
    if (loaded) pending.push(loaded);
  }
  if (pending.length === 0) return;

  const distinctId = await getOrCreateIdentity(statePath);
  const isInternal = process.env.BINDER_INTERNAL === "1";
  const environment = BINDER_VERSION.includes("dev")
    ? "development"
    : "production";

  const commonProperties: Record<string, unknown> = {
    version: BINDER_VERSION,
    $os: platformToOs(process.platform),
    arch: process.arch,
    runtime: runtimeName,
    runtime_version: runtimeVersion,
    environment,
  };
  if (process.env.BINDER_TELEMETRY_PROJECT_HASH) {
    commonProperties.project_hash = process.env.BINDER_TELEMETRY_PROJECT_HASH;
  }

  const { PostHog } = await import("posthog-node");
  const client = new PostHog(key, { host });

  // Mirror distinct_id into the `name` property so PostHog's Persons UI shows
  // our id (e.g. `brd_5E2vpPsrwWU`) instead of its internal person UUID.
  client.identify({
    distinctId,
    properties: {
      name: distinctId,
      ...(isInternal ? { is_internal: true } : {}),
    },
  });

  // Buffer all events into the client, then flush once via shutdown.
  // Only delete source files after shutdown succeeds — otherwise we'd
  // acknowledge delivery for events still sitting in the client buffer.
  let totalEvents = 0;
  for (const { events } of pending) {
    for (const stored of events) {
      const { timestamp, event, ...properties } = stored;
      client.capture({
        distinctId,
        event,
        properties: { ...commonProperties, ...properties },
        timestamp: new Date(timestamp),
      });
      totalEvents += 1;
    }
  }

  const shutdownResult = await tryCatch(() => client.shutdown());
  if (isErr(shutdownResult)) {
    debugLog(
      `shutdown failed (${pending.length} file(s), ${totalEvents} event(s) left for retry): ${shutdownResult.error.message}`,
    );
    return;
  }

  for (const { path, events } of pending) {
    await rm(path, { force: true }).catch(() => {});
    debugLog(`sent ${events.length} event(s) from ${path}`);
  }
};

await flush().catch((error: unknown) => {
  debugLog(`flush failed: ${String(error)}`);
  if (isDebug) process.exit(1);
});
