import { randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { isErr, tryCatch } from "@binder/utils";
import { BINDER_VERSION } from "./environment.ts";
import { getGlobalStatePath } from "./config.ts";

const USAGE_FILE = "usage.jsonl";
const IDENTITY_FILE = "identity";

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

  const identity = randomUUID();
  await mkdir(statePath, { recursive: true });
  await writeFile(identityPath, identity, "utf-8");
  return identity;
};

const flush = async (): Promise<void> => {
  const key = process.env.BINDER_TELEMETRY_KEY;
  if (!key) return;

  const host = process.env.BINDER_TELEMETRY_HOST ?? "https://us.i.posthog.com";

  const statePath = getGlobalStatePath();
  const usagePath = join(statePath, USAGE_FILE);
  const rotatedPath = `${usagePath}.${process.pid}.${Date.now()}.flush`;

  const rotateResult = await tryCatch(() => rename(usagePath, rotatedPath));
  if (isErr(rotateResult)) return;

  const raw = await readFile(rotatedPath, "utf-8").catch(() => "");
  if (!raw.trim()) {
    await rm(rotatedPath, { force: true }).catch(() => {});
    return;
  }

  const events = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(parseLine)
    .filter((e): e is StoredEvent => e !== undefined);

  if (events.length === 0) {
    await rm(rotatedPath, { force: true }).catch(() => {});
    return;
  }

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

  if (isInternal) {
    client.identify({
      distinctId,
      properties: { is_internal: true },
    });
  }

  const sendResult = await tryCatch(async () => {
    for (const stored of events) {
      const { timestamp, event, ...properties } = stored;

      client.capture({
        distinctId,
        event,
        properties: { ...commonProperties, ...properties },
        timestamp: new Date(timestamp),
      });
    }

    await client.shutdown();
    await rm(rotatedPath, { force: true });
  });

  if (isErr(sendResult)) {
    await client.shutdown().catch(() => {});
    await appendFile(usagePath, raw, "utf-8").catch(() => {});
    await rm(rotatedPath, { force: true }).catch(() => {});
  }
};

await flush().catch(() => {});
