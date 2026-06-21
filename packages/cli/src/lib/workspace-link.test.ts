import { readFileSync } from "node:fs";
import { mkdtemp, readlink, rm, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { isErr, throwIfError } from "@binder/utils";
import {
  ensureWorkspaceCliLink,
  findOwnPackageRoot,
} from "./workspace-link.ts";

describe("workspace-link", () => {
  describe("findOwnPackageRoot", () => {
    it("resolves to the @binder.do/cli package root", () => {
      const root = throwIfError(findOwnPackageRoot());
      const pkg = JSON.parse(
        readFileSync(join(root, "package.json"), "utf8"),
      ) as { name: string };
      expect(pkg.name).toBe("@binder.do/cli");
    });
  });

  describe("ensureWorkspaceCliLink", () => {
    let binderDir: string;
    let link: string;

    beforeEach(async () => {
      binderDir = await mkdtemp(join(tmpdir(), "ws-link-"));
      link = join(binderDir, "node_modules", "@binder.do", "cli");
    });

    afterEach(async () => {
      await rm(binderDir, { recursive: true, force: true });
    });

    const expectedTarget = (): string =>
      resolve(throwIfError(findOwnPackageRoot()));

    it("creates a symlink to the running CLI package", async () => {
      const result = await ensureWorkspaceCliLink(binderDir);
      expect(isErr(result)).toBe(false);
      expect(resolve(await readlink(link))).toBe(expectedTarget());
    });

    it("is idempotent", async () => {
      await ensureWorkspaceCliLink(binderDir);
      const second = await ensureWorkspaceCliLink(binderDir);
      expect(isErr(second)).toBe(false);
      expect(resolve(await readlink(link))).toBe(expectedTarget());
    });

    it("replaces a stale link pointing elsewhere", async () => {
      await mkdir(join(binderDir, "node_modules", "@binder.do"), {
        recursive: true,
      });
      await symlink("/nonexistent/old-cli", link, "dir");

      const result = await ensureWorkspaceCliLink(binderDir);
      expect(isErr(result)).toBe(false);
      expect(resolve(await readlink(link))).toBe(expectedTarget());
    });
  });
});
