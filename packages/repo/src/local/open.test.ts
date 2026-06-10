import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { fail, throwIfError } from "@binder/utils";
import "@binder/utils/tests";
import type { SubscriberErrorContext } from "../knowledge-graph.ts";
import { mockTransactionInitInput } from "../model/transaction-input.mock.ts";
import { init, open, resolveWorkspaceRoot } from "./index.ts";
import { BINDER_DIR, CONFIG_FILE, DB_FILE } from "./constants.ts";
import type { BinderRepoPlugin } from "./plugin.ts";

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

  const withProcessState = async (
    opts: { env?: string; cwd?: string },
    fn: () => Promise<void>,
  ): Promise<void> => {
    const previousEnv = process.env.BINDER_WORKSPACE;
    const previousCwd = process.cwd();
    if (opts.env === undefined) delete process.env.BINDER_WORKSPACE;
    else process.env.BINDER_WORKSPACE = opts.env;
    if (opts.cwd) process.chdir(opts.cwd);
    // eslint-disable-next-line no-restricted-syntax -- try/finally for cleanup, not error handling
    try {
      await fn();
    } finally {
      process.chdir(previousCwd);
      if (previousEnv === undefined) delete process.env.BINDER_WORKSPACE;
      else process.env.BINDER_WORKSPACE = previousEnv;
    }
  };

  describe("open()", () => {
    it("errors with workspace-not-found when uninitialized", async () => {
      expect(await open(workspaceRoot)).toBeErrWithKey("workspace-not-found");
    });

    it("resolves via BINDER_WORKSPACE when called with no argument", async () => {
      throwIfError(
        await init(workspaceRoot, { initialConfig: { author: "envuser" } }),
      );
      await withProcessState({ env: workspaceRoot }, async () => {
        const repo = throwIfError(await open());
        expect(repo.config.author).toBe("envuser");
        repo.close();
      });
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
      // Grab close before toMatchObject; Bun replaces matched function
      // properties on the received object with the asymmetric matchers.
      const { close } = repo;

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

  describe("subscriber errors", () => {
    it("routes plugin onCommit failures to onSubscriberError", async () => {
      throwIfError(
        await init(workspaceRoot, { initialConfig: { author: "tester" } }),
      );

      const reported: SubscriberErrorContext[] = [];
      const plugin: BinderRepoPlugin = {
        name: "failing-subscriber",
        register({ repo }) {
          repo.onCommit(
            undefined,
            () => fail("plugin-failed", "boom"),
            "failing-subscriber",
          );
        },
      };

      const repo = throwIfError(
        await open(workspaceRoot, {
          plugins: [plugin],
          onSubscriberError: (_error, context) => {
            reported.push(context);
          },
        }),
      );

      const transaction = throwIfError(
        await repo.update(mockTransactionInitInput),
      );

      expect(reported).toEqual([
        {
          event: "commit",
          transactionId: transaction.id,
          subscriber: "failing-subscriber",
        },
      ]);
      repo.close();
    });
  });

  describe("resolveWorkspaceRoot()", () => {
    it("returns explicit start argument as-is", async () => {
      const result = throwIfError(await resolveWorkspaceRoot(workspaceRoot));
      expect(result).toBe(workspaceRoot);
    });

    it("returns BINDER_WORKSPACE when set and no argument given", () =>
      withProcessState({ env: workspaceRoot }, async () => {
        const result = throwIfError(await resolveWorkspaceRoot());
        expect(result).toBe(workspaceRoot);
      }));

    it("walks up from cwd to find .binder/config.yaml", async () => {
      throwIfError(await init(workspaceRoot));
      const nested = join(workspaceRoot, "a", "b", "c");
      await mkdir(nested, { recursive: true });

      await withProcessState({ cwd: nested }, async () => {
        const result = throwIfError(await resolveWorkspaceRoot());
        // macOS tmp paths can be symlinked (/tmp -> /private/tmp); compare by realpath.
        expect(realpathSync(result)).toBe(realpathSync(workspaceRoot));
      });
    });

    it("fails with workspace-not-found when walk-up finds nothing", async () => {
      const empty = mkdtempSync(join(tmpdir(), "binder-no-ws-"));

      await withProcessState({ cwd: empty }, async () => {
        expect(await resolveWorkspaceRoot()).toBeErrWithKey(
          "workspace-not-found",
        );
      });
      rmSync(empty, { recursive: true, force: true });
    });
  });

  describe("author resolution", () => {
    type AuthorInput = {
      workspace?: string;
      global?: string;
      default?: string;
    };

    const check = async (input: AuthorInput, expected: string) => {
      throwIfError(
        await init(workspaceRoot, {
          initialConfig: input.workspace ? { author: input.workspace } : {},
        }),
      );

      const repo = throwIfError(
        await open(workspaceRoot, {
          configLoadOptions: {
            globalConfig: input.global ? { author: input.global } : {},
            defaultAuthor: input.default,
          },
        }),
      );
      expect(repo.config.author).toBe(expected);
      repo.close();
    };

    it("prefers workspace author over all others", () =>
      check(
        {
          workspace: "from-workspace",
          global: "from-global",
          default: "from-option",
        },
        "from-workspace",
      ));

    it("falls back to global author when workspace is empty", () =>
      check({ global: "from-global", default: "from-option" }, "from-global"));

    it("falls back to defaultAuthor option when no config is set", () =>
      check({ default: "from-option" }, "from-option"));

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
