import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { isErr, throwIfError } from "@binder/utils";
import { openWorkspace } from "../src/workspace.ts";
import { setupWorkspace, teardownWorkspace } from "./setup.ts";

describe("openWorkspace", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await setupWorkspace({ docs: true });
  });

  afterAll(async () => {
    await teardownWorkspace(dir);
  });

  it("stamps transaction provenance with clientId, renders docs, and close() is idempotent", async () => {
    const clientId = "my-test-script";

    const { kg, config, close } = throwIfError(
      await openWorkspace({ clientId, cwd: dir }),
    );
    expect(config.paths.root).toBeTruthy();

    throwIfError(
      await kg.update({
        author: "test",
        records: [
          {
            key: "ws-open-test-1",
            type: "Task",
            title: "Workspace open test",
          },
        ],
      }),
    );

    // transactions.jsonl records the clientId as the source
    const txLog = await readFile(
      join(config.paths.data, "transactions.jsonl"),
      "utf-8",
    );
    const lines = txLog.trim().split("\n");
    const txEntry = JSON.parse(lines[lines.length - 1]);
    expect(txEntry.source).toBe(clientId);

    // docs were rendered to a markdown file for the entity
    const docContent = await readFile(
      join(config.paths.docs, "tasks", "ws-open-test-1.md"),
      "utf-8",
    );
    expect(docContent).toContain("Workspace open test");

    // log file is named from clientId, not the shared library.log
    const logPath = join(config.paths.binder, "logs", `${clientId}.log`);
    await expect(readFile(logPath, "utf-8")).resolves.toBeString();

    // close() is idempotent
    await close();
    await close();
  });

  it("fails when clientId is not kebab-case", async () => {
    const result = await openWorkspace({
      clientId: "../../etc/passwd",
      cwd: dir,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.key).toBe("invalid-client-id");
  });
});
