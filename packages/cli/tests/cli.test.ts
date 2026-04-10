import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  run,
  createRunHelpers,
  setupWorkspace,
  teardownWorkspace,
} from "./setup.ts";

describe("CLI", () => {
  let dir: string;
  const { check, checkError } = createRunHelpers(() => dir);

  beforeAll(async () => {
    dir = await setupWorkspace();
  });

  afterAll(async () => {
    await teardownWorkspace(dir);
  });

  it("--help exits 0 and shows commands", async () => {
    const result = await run(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Commands:");
  });

  describe("schema", () => {
    it("supports --types", async () => {
      await check(["schema", "--types", "Task"], ["Task", "title", "status"]);
    });

    it("supports positional type filters", async () => {
      const taskOnly = await run(["schema", "Task", "--format", "json"], {
        cwd: dir,
      });
      expect(taskOnly.exitCode).toBe(0);
      expect(Object.keys(JSON.parse(taskOnly.stdout).types)).toEqual(["Task"]);

      const taskAndProject = await run(
        ["schema", "Task", "Project", "--format", "json"],
        {
          cwd: dir,
        },
      );
      expect(taskAndProject.exitCode).toBe(0);
      expect(
        Object.keys(JSON.parse(taskAndProject.stdout).types).sort(),
      ).toEqual(["Project", "Task"]);
    });

    it("supports field filtering", async () => {
      const byField = await run(
        ["schema", "-f", "status", "--format", "json"],
        {
          cwd: dir,
        },
      );
      expect(byField.exitCode).toBe(0);

      const parsedByField = JSON.parse(byField.stdout);
      expect(Object.keys(parsedByField.fields)).toEqual(["status"]);

      const byTypeAndField = await run(
        ["schema", "Task", "-f", "status", "--format", "json"],
        { cwd: dir },
      );
      expect(byTypeAndField.exitCode).toBe(0);

      const parsedByTypeAndField = JSON.parse(byTypeAndField.stdout);
      expect(Object.keys(parsedByTypeAndField.types)).toEqual(["Task"]);
      expect(Object.keys(parsedByTypeAndField.fields)).toEqual(["status"]);
    });

    it("reports unknown type and field keys with suggestions", async () => {
      await checkError(["schema", "Taskk"], "Task");
      await checkError(["schema", "-f", "statsu"], "status");
    });
  });

  it("search with filters and plain text", async () => {
    await check(
      ["search", "type=Task", "status=active", "--format", "tsv"],
      (stdout) => {
        const lines = stdout.trim().split("\n");
        expect(lines).toEqual([
          expect.stringContaining("key"),
          expect.stringContaining("task-create-api"),
        ]);
      },
    );

    await check(["search", "authentication", "--format", "json"], (stdout) => {
      const { items } = JSON.parse(stdout);
      expect(items.length).toBeGreaterThan(0);
      expect(items[0].key).toBe("task-implement-user-auth");
    });

    await check(
      ["search", "schema", "type=Task", "--format", "json"],
      (stdout) => {
        const { items } = JSON.parse(stdout);
        expect(items.length).toBe(1);
        expect(items[0].key).toBe("task-implement-auth");
      },
    );
  });

  describe("read", () => {
    it("yaml format", async () => {
      await check(
        ["read", "task-implement-user-auth", "--format", "yaml"],
        [
          "key: task-implement-user-auth",
          "title: Implement user authentication",
          "status: pending",
        ],
      );
    });

    it("field selection and relation traversal", async () => {
      await check(
        [
          "read",
          "task-implement-auth",
          "--format",
          "json",
          "-f",
          "key,title,project(key,title)",
        ],
        (stdout) => {
          expect(JSON.parse(stdout)).toEqual({
            key: "task-implement-auth",
            title: "Implement schema generator",
            project: {
              key: "project-binder-system",
              title: "Binder System",
            },
          });
        },
      );
    });
  });

  describe("update and undo/redo", () => {
    it("update entity field", async () => {
      await check(
        ["update", "task-implement-user-auth", "title=Updated auth task"],
        "Updated auth task",
      );
    });

    it("read back confirms update", async () => {
      await check(
        ["read", "task-implement-user-auth", "--format", "json"],
        (stdout) => {
          expect(JSON.parse(stdout)).toMatchObject({
            key: "task-implement-user-auth",
            title: "Updated auth task",
          });
        },
      );
    });

    it("undo reverts last transaction", async () => {
      await check(["undo"], "Undone successfully");
    });

    it("read back confirms revert after undo", async () => {
      await check(
        ["read", "task-implement-user-auth", "--format", "yaml"],
        "title: Implement user authentication",
      );
    });

    it("redo restores undone transaction", async () => {
      await check(["redo"], "Redone successfully");
    });

    it("invalid data type fails", async () => {
      await checkError(
        ["update", "task-implement-user-auth", "priority=critical"],
        "critical",
      );
    });
  });

  describe("create", () => {
    it("creates entity", async () => {
      await check(
        [
          "create",
          "Task",
          "title=New test task",
          "status=pending",
          "key=task-new",
        ],
        "task-new",
      );
    });

    it("positional key", async () => {
      await check(
        ["create", "Task", "task-positional", "title=Positional key task"],
        "task-positional",
      );
    });

    it("type and key as patches", async () => {
      await check(
        ["create", "type=Task", "key=task-all-patches", "title=All patches"],
        "task-all-patches",
      );
    });

    it("search confirms created entities", async () => {
      await check(["search", "type=Task", "--format", "json"], (stdout) => {
        const keys = JSON.parse(stdout).items.map((i: any) => i.key);
        expect(keys).toEqual(
          expect.arrayContaining([
            "task-new",
            "task-positional",
            "task-all-patches",
          ]),
        );
      });
    });
  });

  describe("delete and undo", () => {
    it("deletes entity and cleans up inverse relations", async () => {
      await check(["delete", "task-create-api"], "deleted");
      await checkError(["read", "task-create-api", "--format", "yaml"]);
      await check(["search", "type=Task", "--format", "json"], (stdout) => {
        const keys = JSON.parse(stdout).items.map((i: any) => i.key);
        expect(keys).not.toContain("task-create-api");
      });
      await check(
        [
          "read",
          "project-binder-system",
          "-f",
          "key,tasks(key)",
          "--format",
          "json",
        ],
        (stdout) => {
          const taskKeys =
            JSON.parse(stdout).tasks?.map((t: any) => t.key) ?? [];
          expect(taskKeys).not.toContain("task-create-api");
        },
      );
    });

    it("undo restores entity and inverse relations", async () => {
      await check(["undo"], "Undone successfully");
      await check(["read", "task-create-api", "--format", "json"], (stdout) => {
        expect(JSON.parse(stdout)).toMatchObject({
          key: "task-create-api",
          title: "Add relationship fields",
          status: "active",
          priority: "medium",
        });
      });
      await check(
        [
          "read",
          "project-binder-system",
          "-f",
          "key,tasks(key)",
          "--format",
          "json",
        ],
        (stdout) => {
          const taskKeys =
            JSON.parse(stdout).tasks?.map((t: any) => t.key) ?? [];
          expect(taskKeys).toContain("task-create-api");
        },
      );
    });
  });

  describe("transactions", () => {
    it("import from file", async () => {
      const txFile = join(dir, "extra-tx.yaml");
      await writeFile(
        txFile,
        [
          "- author: test",
          "  records:",
          "    - key: task-imported",
          "      type: Task",
          "      title: Imported task",
          "      status: active",
        ].join("\n"),
      );
      await check(["tx", "import", txFile, "-q"]);

      await check(
        ["search", "type=Task", "key=task-imported", "--format", "json"],
        (stdout) => {
          expect(JSON.parse(stdout).items).toEqual([
            expect.objectContaining({
              key: "task-imported",
              title: "Imported task",
            }),
          ]);
        },
      );
    });

    it("log shows history", async () => {
      await check(["tx", "log"], ["Transaction #", "test"]);
    });

    it("verify confirms sync", async () => {
      await check(["tx", "verify"], "Database and log are in sync");
    });

    it("squash merges recent transactions", async () => {
      await check(["tx", "squash", "2", "-y"], "Squashed successfully");
    });

    it("export writes yaml file", async () => {
      const outFile = join(dir, "exported.yaml");
      await check(["tx", "export", "-o", outFile, "-n", "1"]);
      const content = await Bun.file(outFile).text();
      expect(content).toContain("author:");
      expect(content).toContain("records:");
    });

    it("verify after squash", async () => {
      await check(["tx", "verify"], "Database and log are in sync");
    });
  });
});
