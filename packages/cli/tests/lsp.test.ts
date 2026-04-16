import { execSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import type { Hover, InitializeResult } from "vscode-languageserver-protocol";
import { waitFor } from "@binder/utils/tests";

import {
  run,
  setupWorkspace,
  teardownWorkspace,
  spawnBinder,
} from "./setup.ts";
import { createLspClient, type LspClient } from "./lsp-client.ts";

describe("LSP", () => {
  let dir: string;
  let client: LspClient;
  let initResult: InitializeResult;

  beforeAll(async () => {
    dir = await setupWorkspace({ docs: true });
    client = createLspClient(spawnBinder("lsp"));
    client.connection.onNotification(
      "window/showMessage",
      (params: ShowMessageParams) => {
        notifications.push(params);
      },
    );
    initResult = await client.initialize(dir);
  }, 15_000);

  afterAll(async () => {
    await client.shutdown();
    await teardownWorkspace(dir);
  });

  const fileUri = (relPath: string) =>
    pathToFileURL(join(dir, "docs", relPath)).toString();

  const readDoc = (relPath: string) =>
    readFile(join(dir, "docs", relPath), "utf-8");

  type ShowMessageParams = { type: number; message: string };
  const notifications: ShowMessageParams[] = [];

  const getHoverContent = (result: Hover): string => {
    if (typeof result.contents === "string") return result.contents;
    if ("value" in result.contents) return result.contents.value;
    return "";
  };

  describe("initialize", () => {
    it("server responds with capabilities", () => {
      expect(initResult.capabilities).toBeDefined();
      expect(initResult.capabilities.textDocumentSync).toBeDefined();
      expect(initResult.capabilities.completionProvider).toBeDefined();
      expect(initResult.capabilities.hoverProvider).toBe(true);
      expect(initResult.capabilities.definitionProvider).toBe(true);
      expect(initResult.capabilities.codeActionProvider).toBeDefined();
    });
  });

  describe("hover", () => {
    it("YAML field key returns field info", async () => {
      const uri = fileUri("tasks-yaml/task-implement-user-auth.yaml");
      const text = await readDoc("tasks-yaml/task-implement-user-auth.yaml");
      client.openDocument(uri, text);

      const lines = text.split("\n");
      const statusLine = lines.findIndex((l) => l.startsWith("status:"));
      expect(statusLine).toBeGreaterThanOrEqual(0);

      const result = await client.hover(uri, statusLine, 2);
      expect(result).not.toBeNull();
      expect(getHoverContent(result!)).toContain("option");
    });
  });

  describe("completion", () => {
    it("suggests missing field keys in YAML", async () => {
      const uri = fileUri("tasks-yaml/task-implement-user-auth.yaml");
      const text = await readDoc("tasks-yaml/task-implement-user-auth.yaml");
      client.openDocument(uri, text);

      const items = await client.completion(uri, 0, 0);
      const labels = items.map((i) => i.label);
      expect(labels.length).toBeGreaterThan(0);
      expect(labels).toContain("tags");
    });

    it("suggests values for option field", async () => {
      const uri = fileUri("tasks-yaml/task-implement-auth.yaml");
      const text = await readDoc("tasks-yaml/task-implement-auth.yaml");
      client.openDocument(uri, text);

      const lines = text.split("\n");
      const statusLine = lines.findIndex((l) => l.startsWith("status:"));
      expect(statusLine).toBeGreaterThanOrEqual(0);

      const items = await client.completion(
        uri,
        statusLine,
        lines[statusLine]!.length,
      );
      const labels = items.map((i) => i.label);
      expect(labels).toContain("pending");
      expect(labels).toContain("active");
    });

    it("reflects didChange content", async () => {
      const relPath = "tasks-yaml/task-create-api.yaml";
      const uri = fileUri(relPath);
      const original = await readDoc(relPath);

      client.openDocument(uri, original);

      const labelsBefore = (await client.completion(uri, 0, 0)).map(
        (i) => i.label,
      );
      expect(labelsBefore).not.toContain("priority");

      const withoutPriority = original
        .split("\n")
        .filter((l) => !l.startsWith("priority:"))
        .join("\n");
      client.openDocument(uri, withoutPriority);

      const labelsAfter = (await client.completion(uri, 0, 0)).map(
        (i) => i.label,
      );
      expect(labelsAfter).toContain("priority");
    });
  });

  describe("diagnostics", () => {
    it("valid file returns no errors", async () => {
      const uri = fileUri("tasks-yaml/task-create-api.yaml");
      const text = await readDoc("tasks-yaml/task-create-api.yaml");
      client.openDocument(uri, text);

      const report = await client.diagnostics(uri);
      expect(report.kind).toBe("full");
      if (report.kind === "full") {
        const errors = report.items.filter((d) => d.severity === 1);
        expect(errors).toEqual([]);
      }
    });

    it("misspelled field reports diagnostic with fix code action", async () => {
      const uri = fileUri("tasks-yaml/task-implement-user-auth.yaml");
      const text = await readDoc("tasks-yaml/task-implement-user-auth.yaml");
      const modified = text.replace(/status:/, "stauts:");
      client.openDocument(uri, modified);

      const report = await client.diagnostics(uri);
      expect(report.kind).toBe("full");
      if (report.kind !== "full") return;

      const diagnostic = report.items.find(
        (d) => d.code === "invalid-field" || d.code === "unknown-field",
      );
      expect(diagnostic).toBeDefined();
      expect(diagnostic!.message).toContain("stauts");

      const line = diagnostic!.range.start.line;
      const actions = await client.codeActions(
        uri,
        line,
        0,
        line,
        modified.split("\n")[line]!.length,
        [diagnostic],
      );

      const replaceAction = actions.find((a) =>
        a.title.includes("Replace with 'status'"),
      );
      expect(replaceAction).toBeDefined();

      const fixed = client.applyCodeAction(replaceAction!, uri, modified);
      expect(fixed).toContain("status:");

      client.openDocument(uri, fixed);
      const afterReport = await client.diagnostics(uri);
      expect(afterReport.kind).toBe("full");
      if (afterReport.kind !== "full") return;
      const remaining = afterReport.items.filter(
        (d) => d.code === "invalid-field" || d.code === "unknown-field",
      );
      expect(remaining).toEqual([]);
    });

    it("invalid field value reports error", async () => {
      const uri = fileUri("tasks-yaml/task-create-api.yaml");
      const text = await readDoc("tasks-yaml/task-create-api.yaml");
      client.openDocument(
        uri,
        text.replace(/status: \w+/, "status: bogus-status"),
      );

      const report = await client.diagnostics(uri);
      expect(report.kind).toBe("full");
      if (report.kind === "full") {
        const errors = report.items.filter((d) => d.severity === 1);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0]!.message).toContain("status");
      }
    });
  });

  describe("sync on save", () => {
    it("triggers sync and updates DB", async () => {
      const relPath = "tasks-yaml/task-implement-auth.yaml";
      const uri = fileUri(relPath);
      const text = await readDoc(relPath);
      const edited = text.replace(/title: .+/, "title: LSP-edited title");

      await writeFile(join(dir, "docs", relPath), edited);
      client.openDocument(uri, edited);
      client.saveDocument(uri);

      await waitFor(async () => {
        const result = await run(
          ["read", "task-implement-auth", "--format", "json"],
          { cwd: dir },
        );
        expect(result.exitCode).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({
          title: "LSP-edited title",
        });
      });
    });

    it("with changes sends info notification", async () => {
      const relPath = "tasks-yaml/task-create-api.yaml";
      const uri = fileUri(relPath);
      const text = await readDoc(relPath);
      const edited = text.replace(/title: .+/, "title: Notification-test");

      notifications.length = 0;
      await writeFile(join(dir, "docs", relPath), edited);
      client.openDocument(uri, edited);
      client.saveDocument(uri);

      await waitFor(() => {
        const info = notifications.filter((n) => n.type === 3);
        expect(info.length).toBeGreaterThan(0);
        expect(info[0]!.message).toMatch(/saved/i);
      });
    });

    it("without changes sends no notification", async () => {
      const relPath = "tasks-yaml/task-create-api.yaml";
      const uri = fileUri(relPath);
      const text = await readDoc(relPath);

      notifications.length = 0;
      client.openDocument(uri, text);
      client.saveDocument(uri);

      await new Promise((r) => setTimeout(r, 1500));
      expect(notifications.filter((n) => n.type === 3)).toEqual([]);
    }, 10_000);

    it("rapid saves converge to the last written content", async () => {
      const relPath = "tasks-yaml/task-implement-auth.yaml";
      const absPath = join(dir, "docs", relPath);
      const uri = fileUri(relPath);
      const original = await readDoc(relPath);

      client.openDocument(uri, original);

      const lastTitle = "Rapid-Save-Final";
      for (const title of ["Rapid-A", "Rapid-B", "Rapid-C", lastTitle]) {
        const edited = original.replace(/title: .+/, `title: ${title}`);
        await writeFile(absPath, edited);
        client.openDocument(uri, edited);
        client.saveDocument(uri);
      }

      await waitFor(async () => {
        const result = await run(
          ["read", "task-implement-auth", "-f", "title", "--format", "json"],
          { cwd: dir },
        );
        expect(result.exitCode).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({ title: lastTitle });
      });
    }, 10_000);
  });
});

describe("LSP multi-root", () => {
  let parentDir: string;
  let subA: string;
  let subB: string;
  let client: LspClient;

  beforeAll(async () => {
    const tmpA = await setupWorkspace({ docs: true });
    const tmpB = await setupWorkspace({ docs: true });
    parentDir = await mkdtemp(join(tmpdir(), "binder-multi-"));
    subA = join(parentDir, "project-a");
    subB = join(parentDir, "project-b");
    execSync(`mv ${tmpA} ${subA}`);
    execSync(`mv ${tmpB} ${subB}`);

    client = createLspClient(spawnBinder("lsp"));
    await client.initialize(parentDir);
  }, 30_000);

  afterAll(async () => {
    await client.shutdown();
    await teardownWorkspace(parentDir);
  });

  const mFileUri = (base: string, rel: string) =>
    pathToFileURL(join(base, "docs", rel)).toString();

  it("discovers both subdirectory workspaces", async () => {
    const file = "tasks-yaml/task-create-api.yaml";
    for (const base of [subA, subB]) {
      const uri = mFileUri(base, file);
      const text = await readFile(join(base, "docs", file), "utf-8");
      client.openDocument(uri, text);
      const items = await client.completion(uri, 0, 0);
      expect(items.length).toBeGreaterThan(0);
    }
  });
});

describe("LSP multi-root explicit workspaces", () => {
  let parentDir: string;
  let subA: string;
  let subB: string;
  let client: LspClient;

  beforeAll(async () => {
    const tmpA = await setupWorkspace({ docs: true });
    const tmpB = await setupWorkspace({ docs: true });
    parentDir = await mkdtemp(join(tmpdir(), "binder-multi-"));
    subA = join(parentDir, "project-a");
    subB = join(parentDir, "project-b");
    execSync(`mv ${tmpA} ${subA}`);
    execSync(`mv ${tmpB} ${subB}`);

    client = createLspClient(spawnBinder("lsp"));
    await client.initialize(parentDir, { workspaces: ["project-a"] });
  }, 30_000);

  afterAll(async () => {
    await client.shutdown();
    await teardownWorkspace(parentDir);
  });

  const mFileUri = (base: string, rel: string) =>
    pathToFileURL(join(base, "docs", rel)).toString();

  it("only activates listed workspace", async () => {
    const file = "tasks-yaml/task-create-api.yaml";

    const uriA = mFileUri(subA, file);
    client.openDocument(
      uriA,
      await readFile(join(subA, "docs", file), "utf-8"),
    );
    expect((await client.completion(uriA, 0, 0)).length).toBeGreaterThan(0);

    const uriB = mFileUri(subB, file);
    client.openDocument(
      uriB,
      await readFile(join(subB, "docs", file), "utf-8"),
    );
    expect(await client.completion(uriB, 0, 0)).toEqual([]);
  });
});
