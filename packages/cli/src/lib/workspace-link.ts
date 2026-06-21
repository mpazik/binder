import { readFileSync } from "node:fs";
import { mkdir, readlink, rename, rm, symlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  fail,
  isErr,
  ok,
  okVoid,
  type Result,
  type ResultAsync,
  tryCatch,
} from "@binder/utils";

const PACKAGE_NAME = "@binder.do/cli";

const readPackageName = (pkgPath: string): string | null => {
  const result = tryCatch(() => {
    const parsed = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      name?: string;
    };
    return parsed.name ?? null;
  });
  return isErr(result) ? null : result.data;
};

/**
 * Locates the root of the running CLI package by walking up from this module to
 * the nearest `package.json` named `@binder.do/cli`. Works both from `src/` in
 * dev and from the bundled `dist/` in production.
 */
export const findOwnPackageRoot = (): Result<string> => {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 12; depth++) {
    if (readPackageName(join(dir, "package.json")) === PACKAGE_NAME) {
      return ok(dir);
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return fail(
    "package-root-not-found",
    `Could not locate the ${PACKAGE_NAME} package root from ${import.meta.url}`,
  );
};

/**
 * Points `<binderDir>/node_modules/@binder.do/cli` at the running CLI so that
 * workspace scripts can `import "@binder.do/cli/workspace"` and resolve the exact
 * version that launched them. Idempotent; an existing link to a different target
 * is replaced atomically (symlink to a temp name, then rename over).
 */
export const ensureWorkspaceCliLink = async (
  binderDir: string,
): ResultAsync<void> => {
  const rootResult = findOwnPackageRoot();
  if (isErr(rootResult)) return rootResult;
  const target = rootResult.data;

  const linkParent = join(binderDir, "node_modules", "@binder.do");
  const link = join(linkParent, "cli");

  const current = await tryCatch(() => readlink(link));
  if (
    !isErr(current) &&
    resolve(linkParent, current.data) === resolve(target)
  ) {
    return okVoid;
  }

  const mkdirResult = await tryCatch(() =>
    mkdir(linkParent, { recursive: true }),
  );
  if (isErr(mkdirResult)) return mkdirResult;

  const linkType = process.platform === "win32" ? "junction" : "dir";
  const tmp = `${link}.tmp-${process.pid}`;
  await tryCatch(() => rm(tmp, { recursive: true, force: true }));
  const made = await tryCatch(() => symlink(target, tmp, linkType));
  if (isErr(made)) return made;

  const renamed = await tryCatch(() => rename(tmp, link));
  if (isErr(renamed)) {
    // rename-over can fail when a non-symlink already occupies the path; clear
    // it and retry once before giving up.
    await tryCatch(() => rm(link, { recursive: true, force: true }));
    const retry = await tryCatch(() => rename(tmp, link));
    if (isErr(retry)) {
      await tryCatch(() => rm(tmp, { recursive: true, force: true }));
      return retry;
    }
  }
  return okVoid;
};
