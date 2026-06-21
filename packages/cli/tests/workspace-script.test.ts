import { mkdir, readFile, readlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { binderDir, run, setupWorkspace, teardownWorkspace } from "./setup.ts";

// A workspace script that imports the bundled library entry. The CLI must link
// itself into the workspace so this bare specifier resolves to the running
// version.
const SEED_SCRIPT = `
import { openWorkspace, isErr } from "@binder.do/cli/workspace";

const result = await openWorkspace({ clientId: "seed-script" });
if (isErr(result)) {
  console.error("open failed:", result.error.message);
  process.exit(1);
}
const { kg, close } = result.data;
const tx = await kg.update({
  author: "seed",
  records: [{ key: "script-made-1", type: "Task", title: "Made by a script" }],
});
if (isErr(tx)) {
  console.error("update failed:", tx.error.message);
  process.exit(1);
}
await close();
console.log("seed-done");
`;

describe("openWorkspace from a workspace script", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await setupWorkspace({ docs: true });
    const scriptsDir = join(dir, binderDir, "scripts");
    await mkdir(scriptsDir, { recursive: true });
    await writeFile(join(scriptsDir, "seed.ts"), SEED_SCRIPT);
  });

  afterAll(async () => {
    await teardownWorkspace(dir);
  });

  it("links the CLI and resolves the library import end to end", async () => {
    const result = await run(["run", "seed"], { cwd: dir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("seed-done");

    // The CLI linked itself into the workspace so the bare import resolved.
    const link = join(dir, binderDir, "node_modules", "@binder.do", "cli");
    const target = await readlink(link);
    expect(target).toContain("packages/cli");

    // The script's commit went through the full runtime: journaled with the
    // clientId as provenance.
    const txLog = await readFile(
      join(dir, binderDir, "data", "transactions.jsonl"),
      "utf-8",
    );
    const lines = txLog.trim().split("\n");
    const lastTx = JSON.parse(lines[lines.length - 1]!);
    expect(lastTx.source).toBe("seed-script");

    // The record is queryable via the CLI.
    const read = await run(["read", "script-made-1"], { cwd: dir });
    expect(read.exitCode).toBe(0);
    expect(read.stdout).toContain("Made by a script");
  });
});
