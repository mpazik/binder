import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { throwIfError } from "@binder/utils";
import "@binder/utils/tests";
import { init, open } from "./index.ts";
import { BINDER_DIR, CONFIG_FILE, DB_FILE } from "./constants.ts";

describe("@binder/repo/local", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "binder-local-test-"));
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  const fileExists = (path: string): Promise<boolean> =>
    readFile(path).then(
      () => true,
      () => false,
    );

  describe("open()", () => {
    it("errors with workspace-not-found when uninitialized", async () => {
      expect(await open(workspaceRoot)).toBeErrWithKey("workspace-not-found");
    });

    it("loads workspace config and paths", async () => {
      throwIfError(
        await init(workspaceRoot, { initialConfig: { author: "tester" } }),
      );

      const repo = throwIfError(await open(workspaceRoot));
      expect(repo.config).toMatchObject({
        author: "tester",
        paths: {
          root: workspaceRoot,
          binder: join(workspaceRoot, BINDER_DIR),
          data: join(workspaceRoot, BINDER_DIR, "data"),
        },
      });
      repo.close();
    });
  });

  describe("init()", () => {
    it("writes config.yaml and creates data/ directory", async () => {
      const repo = throwIfError(
        await init(workspaceRoot, { initialConfig: { author: "creator" } }),
      );

      const configPath = join(workspaceRoot, BINDER_DIR, CONFIG_FILE);
      const dbPath = join(workspaceRoot, BINDER_DIR, "data", DB_FILE);

      expect(await fileExists(configPath)).toBe(true);
      expect(await fileExists(dbPath)).toBe(true);
      expect(await readFile(configPath, "utf-8")).toContain("author: creator");
      repo.close();
    });

    it("errors with workspace-exists on re-init", async () => {
      throwIfError(await init(workspaceRoot));

      expect(await init(workspaceRoot)).toBeErrWithKey("workspace-exists");
    });

    it("honors binderDir override", async () => {
      const repo = throwIfError(
        await init(workspaceRoot, { binderDir: ".binder-dev" }),
      );

      expect(repo.config.paths.binder).toBe(join(workspaceRoot, ".binder-dev"));
      repo.close();
    });
  });

  describe("lifecycle", () => {
    it("persists the database across close and reopen", async () => {
      const repo1 = throwIfError(
        await init(workspaceRoot, { initialConfig: { author: "alice" } }),
      );
      expect(Number(throwIfError(await repo1.version()).id)).toBe(0);
      repo1.close();

      const repo2 = throwIfError(await open(workspaceRoot));
      expect(repo2.config.author).toBe("alice");
      expect(Number(throwIfError(await repo2.version()).id)).toBe(0);
      repo2.close();
    });

    it("exposes db handle and knowledge-graph methods", async () => {
      const repo = throwIfError(await init(workspaceRoot));
      const close = repo.close;

      expect(repo).toMatchObject({
        db: expect.any(Object),
        close: expect.any(Function),
        update: expect.any(Function),
        search: expect.any(Function),
        version: expect.any(Function),
      });
      close();
    });
  });

  describe("author resolution", () => {
    const checkAuthor = async (
      author: string | undefined,
      globalAuthor: string | undefined,
      defaultAuthor: string | undefined,
      expected: string,
    ) => {
      throwIfError(
        await init(workspaceRoot, {
          initialConfig: author === undefined ? {} : { author },
        }),
      );

      const repo = throwIfError(
        await open(workspaceRoot, {
          configLoadOptions: {
            globalConfig:
              globalAuthor === undefined ? {} : { author: globalAuthor },
            defaultAuthor,
          },
        }),
      );
      expect(repo.config.author).toBe(expected);
      repo.close();
    };

    it("prefers workspace author over all others", () =>
      checkAuthor(
        "from-workspace",
        "from-global",
        "from-option",
        "from-workspace",
      ));

    it("falls back to global author when workspace is empty", () =>
      checkAuthor(undefined, "from-global", "from-option", "from-global"));

    it("falls back to defaultAuthor option when no config is set", () =>
      checkAuthor(undefined, undefined, "from-option", "from-option"));

    it("falls back to OS-derived default as last resort", async () => {
      throwIfError(await init(workspaceRoot));
      const repo = throwIfError(
        await open(workspaceRoot, {
          configLoadOptions: { globalConfig: {} },
        }),
      );
      // getDefaultAuthor reads USER/USERNAME/LOGNAME env vars;
      // whatever it returns, it must be a non-empty string.
      expect(typeof repo.config.author).toBe("string");
      expect(repo.config.author.length).toBeGreaterThan(0);
      repo.close();
    });
  });
});
