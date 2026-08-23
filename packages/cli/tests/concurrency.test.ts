import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { run, setupWorkspace, teardownWorkspace } from "./setup.ts";

describe("concurrent writers", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await setupWorkspace();
  });

  afterAll(async () => {
    await teardownWorkspace(dir);
  });

  it("serializes updates from separate CLI processes", async () => {
    const updates = [
      ["task-implement-user-auth", "Concurrent auth update"],
      ["task-implement-auth", "Concurrent schema update"],
      ["task-create-api", "Concurrent API update"],
      ["project-binder-system", "Concurrent project update"],
    ] as const;

    const results = await Promise.all(
      updates.map(([key, title]) =>
        run(["update", key, `title=${title}`, "-q"], { cwd: dir }),
      ),
    );

    for (const result of results) {
      expect(result.exitCode).toBe(0);
      expect(result.stderr).not.toContain("UNIQUE constraint failed");
    }

    for (const [key, title] of updates) {
      const result = await run(["read", key, "--format", "json"], {
        cwd: dir,
      });
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout).title).toBe(title);
    }

    const upserts = await Promise.all(
      [1, 2, 3, 4].map((n) =>
        run(
          [
            "create",
            "Task",
            "concurrent-upsert",
            `title=Concurrent upsert ${n}`,
            "-q",
          ],
          { cwd: dir },
        ),
      ),
    );
    for (const result of upserts) {
      expect(result.exitCode).toBe(0);
      expect(result.stderr).not.toContain("UNIQUE constraint failed");
    }

    const verify = await run(["journal", "verify", "-q"], { cwd: dir });
    expect(verify.exitCode).toBe(0);
  });
});
