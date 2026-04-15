declare const __BINDER_VERSION__: string | undefined;
declare const __BINDER_TELEMETRY_KEY__: string | undefined;
declare const __BINDER_TELEMETRY_HOST__: string | undefined;

export const BINDER_VERSION =
  typeof __BINDER_VERSION__ !== "undefined" ? __BINDER_VERSION__ : "0.0.0-dev";

/** PostHog API key. Resolved from env var, then build-time define, then undefined (disables telemetry). */
export const BINDER_TELEMETRY_KEY =
  process.env.BINDER_TELEMETRY_KEY ??
  (typeof __BINDER_TELEMETRY_KEY__ !== "undefined"
    ? __BINDER_TELEMETRY_KEY__
    : undefined);

/** PostHog ingestion host. Resolved from env var, then build-time define, then default. */
export const BINDER_TELEMETRY_HOST =
  process.env.BINDER_TELEMETRY_HOST ??
  (typeof __BINDER_TELEMETRY_HOST__ !== "undefined"
    ? __BINDER_TELEMETRY_HOST__
    : "https://us.i.posthog.com");

export const isBundled = () => typeof __BINDER_VERSION__ !== "undefined";
export const isDevMode = () => !isBundled();
export const isBun = process.versions.bun !== undefined;
export const isTest = process.env.NODE_ENV === "test";
