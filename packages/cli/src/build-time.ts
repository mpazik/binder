declare const __BINDER_VERSION__: string | undefined;

export const BINDER_VERSION =
  typeof __BINDER_VERSION__ !== "undefined" ? __BINDER_VERSION__ : "0.0.0-dev";

export const isBundled = () => typeof __BINDER_VERSION__ !== "undefined";
export const isDevMode = () => !isBundled();
