import { realpathSync } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  run,
  binderDir,
  createRunHelpers,
  setupWorkspace,
  teardownWorkspace,
} from "./setup.ts";

describe("workspace scripts", () => {
  let dir: string;
  let scriptsDir: string;
  const { checkError } = createRunHelpers(() => dir);

  const writeScript = async (
    name: string,
    body: string,
    opts?: { executable?: boolean },
  ): Promise<string> => {
    const path = join(scriptsDir, name);
    await writeFile(path, body);
    if (opts?.executable) await chmod(path, 0o755);
    return path;
  };

  beforeAll(async () => {
    dir = await setupWorkspace();
    scriptsDir = join(dir, binderDir, "scripts");
    await mkdir(scriptsDir, { recursive: true });
  });

  afterAll(async () => {
    await teardownWorkspace(dir);
  });

  describe("listing", () => {
    it("reports 'No scripts found' when none exist", async () => {
      // Tests run sequentially against a shared workspace; check listing
      // before adding any scripts.
      const empty = await setupWorkspace();
      // eslint-disable-next-line no-restricted-syntax
      try {
        const result = await run(["run"], { cwd: empty });
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("No scripts found");
      } finally {
        await teardownWorkspace(empty);
      }
    });

    it("lists discovered scripts with paths", async () => {
      await writeScript("hello.ts", `console.log("hi from ts");\n`);
      await writeScript("say.sh", `#!/bin/sh\necho "hi from sh"\n`, {
        executable: true,
      });

      const result = await run(["run"], { cwd: dir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("hello");
      expect(result.stdout).toContain(join(scriptsDir, "hello.ts"));
      expect(result.stdout).toContain("say");
      expect(result.stdout).toContain(join(scriptsDir, "say.sh"));
    });

    it("flags scripts shadowed by built-in commands", async () => {
      await writeScript("search.ts", `console.log("custom search");\n`);

      const result = await run(["run"], { cwd: dir });
      expect(result.exitCode).toBe(0);
      // The line for `search` should carry the shadowed marker.
      const searchLine = result.stdout
        .split("\n")
        .find((l) => l.startsWith("search"));
      expect(searchLine).toBeDefined();
      expect(searchLine!).toContain("(shadowed)");
    });
  });

  describe("execution", () => {
    it("forwards argv and sets BINDER_WORKSPACE", async () => {
      await writeScript(
        "echo.ts",
        `console.log("argv:", process.argv.slice(2).join(" "));\n` +
          `console.log("ws:", process.env.BINDER_WORKSPACE);\n`,
      );

      const result = await run(["run", "echo", "alpha", "--beta", "gamma"], {
        cwd: dir,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("argv: alpha --beta gamma");
      // macOS tmp paths can be symlinked; subprocess sees the realpath.
      expect(result.stdout).toContain(`ws: ${realpathSync(dir)}`);
    });

    it("propagates non-zero exit codes", async () => {
      await writeScript("fail.sh", `#!/bin/sh\necho boom\nexit 7\n`, {
        executable: true,
      });

      const result = await run(["run", "fail"], { cwd: dir });
      expect(result.exitCode).toBe(7);
      expect(result.stdout).toContain("boom");
    });

    it("reports a clear error for unknown script names", async () => {
      await checkError(
        ["run", "does-not-exist"],
        "No script named 'does-not-exist'",
      );
    });
  });

  describe("bare dispatch", () => {
    it("runs a script when its name is not a built-in", async () => {
      await writeScript("myscript.ts", `console.log("ran myscript");\n`);

      const result = await run(["myscript", "x"], { cwd: dir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("ran myscript");
    });

    it("prefers built-in commands over scripts on conflict", async () => {
      // `search.ts` was created in the listing test; the built-in must win.
      const result = await run(["search", "type=Task"], { cwd: dir });
      expect(result.exitCode).toBe(0);
      // Output is JSON (non-TTY default); built-in search returns an items array.
      expect(result.stdout).not.toContain("custom search");
    });
  });
});
