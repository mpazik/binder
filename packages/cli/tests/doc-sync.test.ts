import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { stringify } from "yaml";
import {
  mockProjectKey,
  mockProjectRecord,
  mockProjectType,
  mockProjectTypeKey,
  mockTask1Key,
  mockTask1Record,
  mockTaskTypeKey,
} from "@binder/repo/mocks";
import {
  binderDir,
  createRunHelpers,
  run,
  setupWorkspace,
  teardownWorkspace,
} from "./setup.ts";

describe("Doc Sync", () => {
  let dir: string;
  const { check, checkError } = createRunHelpers(() => dir);

  beforeAll(async () => {
    dir = await setupWorkspace({ docs: true });
  });

  afterAll(async () => {
    await teardownWorkspace(dir);
  });

  const readDoc = (relPath: string) =>
    readFile(join(dir, "docs", relPath), "utf-8");

  const writeDoc = async (relPath: string, content: string) => {
    const fullPath = join(dir, "docs", relPath);
    await mkdir(join(fullPath, ".."), { recursive: true });
    await writeFile(fullPath, content);
  };

  const removeDoc = (relPath: string) =>
    rm(join(dir, "docs", relPath), { force: true });

  const docExists = (relPath: string) =>
    Bun.file(join(dir, "docs", relPath)).exists();

  describe("render", () => {
    it("creates files for seeded entities", async () => {
      await check(["docs", "render"]);
      expect(await docExists("tasks/task-implement-user-auth.md")).toBe(true);
      expect(await docExists("tasks/task-implement-auth.md")).toBe(true);
      expect(await docExists("tasks/task-create-api.md")).toBe(true);
      expect(await docExists("projects/project-binder-system.md")).toBe(true);
    });

    it("file content matches DB data", async () => {
      const content = await readDoc("tasks/task-implement-user-auth.md");
      expect(content).toContain("Implement user authentication");
      expect(content).toContain("task-implement-user-auth");
    });

    it("create via CLI auto-renders new file", async () => {
      await check([
        "create",
        "Task",
        "title=Auto-rendered task",
        "key=task-auto-rendered",
      ]);

      expect(await docExists("tasks/task-auto-rendered.md")).toBe(true);
      const content = await readDoc("tasks/task-auto-rendered.md");
      expect(content).toContain("Auto-rendered task");
    });
  });

  describe("sync", () => {
    it("edit file on disk and sync back updates DB", async () => {
      const original = await readDoc("tasks/task-implement-user-auth.md");
      const edited = original.replace(
        "Implement user authentication",
        "Updated via file edit",
      );
      await writeDoc("tasks/task-implement-user-auth.md", edited);

      await check(["docs", "sync"]);

      await check(
        ["read", "task-implement-user-auth", "--format", "json"],
        (stdout) => {
          expect(JSON.parse(stdout)).toMatchObject({
            title: "Updated via file edit",
          });
        },
      );
    });

    it("with explicit path detects changes", async () => {
      const original = await readDoc("tasks/task-implement-auth.md");
      const edited = original.replace(
        "Implement schema generator",
        "Edited via explicit path",
      );
      await writeDoc("tasks/task-implement-auth.md", edited);

      await check(
        ["docs", "sync", "docs/tasks/task-implement-auth.md"],
        "Synchronized",
      );

      await check(
        ["read", "task-implement-auth", "--format", "json"],
        (stdout) => {
          expect(JSON.parse(stdout)).toMatchObject({
            title: "Edited via explicit path",
          });
        },
      );
    });

    it("new file creates entity and re-renders", async () => {
      // Empty file -> entity created from where + path, file backfilled
      await writeDoc("teams/team-new.yaml", "");
      await check(["docs", "sync"]);
      await check(["read", "team-new", "--format", "json"], (stdout) => {
        expect(JSON.parse(stdout)).toMatchObject({
          type: "Team",
          key: "team-new",
        });
      });
      const rendered = await readDoc("teams/team-new.yaml");
      expect(rendered).toContain("key: team-new");

      // File with content -> entity created with extracted fields
      await writeDoc("tasks-yaml/task-from-file.yaml", "title: From File\n");
      await check(["docs", "sync"]);
      await check(["read", "task-from-file", "--format", "json"], (stdout) => {
        expect(JSON.parse(stdout)).toMatchObject({
          type: "Task",
          key: "task-from-file",
          title: "From File",
        });
      });

      // Wrong data type -> rejected
      await writeDoc("tasks-yaml/task-bad.yaml", "title: 123\n");
      await checkError(["docs", "sync"], "Expected string");
      await removeDoc("tasks-yaml/task-bad.yaml");
    });
  });

  describe("render after failed sync", () => {
    it("render without --force warns about diverged files", async () => {
      // Use task-create-api which has status: active and hasn't been
      // modified by earlier tests
      await check(["docs", "render"]);

      const original = await readDoc("tasks-yaml/task-create-api.yaml");
      expect(original).toContain("status: active");

      const bad = original.replace("status: active", "status: INVALID_VALUE");
      await writeDoc("tasks-yaml/task-create-api.yaml", bad);

      const syncResult = await run(["docs", "sync"], { cwd: dir });
      expect(syncResult.exitCode).not.toBe(0);

      const afterFailedSync = await readDoc("tasks-yaml/task-create-api.yaml");
      expect(afterFailedSync).toContain("status: INVALID_VALUE");

      const renderResult = await run(["docs", "render"], { cwd: dir });
      expect(renderResult.exitCode).toBe(0);
      expect(renderResult.stdout).toContain("differ from the database");
      expect(renderResult.stdout).toContain("--force");

      const afterRender = await readDoc("tasks-yaml/task-create-api.yaml");
      expect(afterRender).toContain("status: INVALID_VALUE");
    });

    it("render --force overwrites diverged file and restores DB state", async () => {
      // File still has INVALID_VALUE from previous test
      expect(await readDoc("tasks-yaml/task-create-api.yaml")).toContain(
        "status: INVALID_VALUE",
      );

      const forceResult = await run(["docs", "render", "--force"], {
        cwd: dir,
      });
      expect(forceResult.exitCode).toBe(0);

      const afterForce = await readDoc("tasks-yaml/task-create-api.yaml");
      expect(afterForce).toContain("status: active");
      expect(afterForce).not.toContain("INVALID_VALUE");

      await check(
        ["docs", "sync", "tasks-yaml/task-create-api.yaml"],
        "No changes",
      );
    });

    it("render --force restores markdown file after manual corruption", async () => {
      await check(["docs", "render"]);

      const original = await readDoc("tasks/task-create-api.md");
      expect(original).toContain("Add relationship fields");

      await writeDoc("tasks/task-create-api.md", "completely wrong content");

      // Render (default verify mode) detects divergence
      const renderResult = await run(["docs", "render"], { cwd: dir });
      expect(renderResult.exitCode).toBe(0);
      expect(renderResult.stdout).toContain("differ from the database");

      const afterRender = await readDoc("tasks/task-create-api.md");
      expect(afterRender).toBe("completely wrong content");

      const forceResult = await run(["docs", "render", "--force"], {
        cwd: dir,
      });
      expect(forceResult.exitCode).toBe(0);

      const restored = await readDoc("tasks/task-create-api.md");
      expect(restored).toContain("Add relationship fields");

      await check(["docs", "sync", "tasks/task-create-api.md"], "No changes");
    });
  });

  describe("lint", () => {
    it("clean docs produce no stdout", async () => {
      const result = await run(["docs", "lint", "--config"], { cwd: dir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("");
    });

    it("wrong data type and unknown field report errors", async () => {
      await writeDoc(
        "tasks-yaml/task-lint-errors.yaml",
        "title: 123\nfakeField: hello\n",
      );

      await checkError(["docs", "lint"], {
        stdout: ["task-lint-errors", "invalid-value", "invalid-field"],
        stderr: "Found 2 error",
      });

      await removeDoc("tasks-yaml/task-lint-errors.yaml");
    });

    it("malformed YAML frontmatter in doc file reports error", async () => {
      const docPath = "tasks/task-implement-user-auth.md";
      const original = await readDoc(docPath);

      await writeDoc(docPath, "---\nstatus: [[[broken\n---\n\nBody\n");
      await checkError(["docs", "lint"], {
        stdout: ["task-implement-user-auth.md", "yaml-syntax-error"],
        stderr: "Found",
      });

      await writeDoc(docPath, original);
    });
  });

  it("undo re-renders View entity files", async () => {
    await check([
      "update",
      "task-view",
      "--namespace",
      "config",
      "name=Renamed",
    ]);
    await check(["undo"], "Undone successfully");

    const content = await readFile(
      join(dir, binderDir, "views", "task-view.md"),
      "utf-8",
    );
    expect(content).toContain("Task view");
  });
});

describe("Doc Sync — relation projection creates entity with only constraint", () => {
  let dir: string;
  const { check } = createRunHelpers(() => dir);

  beforeAll(async () => {
    dir = await setupWorkspace({ docs: true });

    // `requires` is a standard field (relation, allowMultiple, no range).
    // Add it to Project with only: [Task] so the nav config can infer the type
    // for nested entities without explicitly specifying it in includes.
    const setup = stringify([
      {
        author: "test",
        configs: [
          {
            key: mockProjectTypeKey,
            fields: [
              ...mockProjectType.fields,
              ["requires", { only: [mockTaskTypeKey] }],
            ],
          },
          {
            key: "nav-project-reqs",
            type: "Navigation",
            path: "project-reqs/{key}",
            where: { type: mockProjectTypeKey },
            includes: {
              key: true,
              title: true,
              status: true,
              requires: { title: true, status: true },
            },
          },
        ],
        records: [{ key: mockProjectKey, requires: [mockTask1Key] }],
      },
    ]);
    const file = join(dir, "extra-setup.yaml");
    await writeFile(file, setup);
    await run(["tx", "import", file, "-q"], { cwd: dir });
  });

  afterAll(async () => {
    await teardownWorkspace(dir);
  });

  const readDoc = (relPath: string) =>
    readFile(join(dir, "docs", relPath), "utf-8");

  const writeDoc = async (relPath: string, content: string) => {
    const fullPath = join(dir, "docs", relPath);
    await mkdir(join(fullPath, ".."), { recursive: true });
    await writeFile(fullPath, content);
  };

  it("adding item to relation projection syncs and creates entity", async () => {
    const docPath = `project-reqs/${mockProjectKey}.yaml`;
    await check(["docs", "render"]);

    const original = await readDoc(docPath);
    expect(original).toContain(mockTask1Record.title);

    await writeDoc(
      docPath,
      stringify({
        key: mockProjectKey,
        title: mockProjectRecord.title,
        status: mockProjectRecord.status,
        requires: [
          { title: mockTask1Record.title, status: mockTask1Record.status },
          { title: "New task from doc", status: "pending" },
        ],
      }),
    );

    await check(["docs", "sync"], "Synchronized");

    await check(
      [
        "search",
        `type=${mockTaskTypeKey}`,
        "title=New task from doc",
        "--format",
        "json",
      ],
      (stdout) => {
        const result = JSON.parse(stdout);
        expect(result.items).toHaveLength(1);
        expect(result.items[0]).toMatchObject({
          type: mockTaskTypeKey,
          title: "New task from doc",
        });
      },
    );
  });
});
