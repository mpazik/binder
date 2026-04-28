import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { setupWorkspace, teardownWorkspace } from "./setup.ts";

const REPO_ROOT = new URL("../../..", import.meta.url).pathname;
const CLI_ENTRY = `${REPO_ROOT}/packages/cli/src/index.ts`;

const SERVER_TS = `import { Hono } from "hono";
import type { ServerModule } from "@binder.do/cli";

const mod: ServerModule = () => {
  const app = new Hono();
  app.get("/api/custom", (c) => c.json({ ok: true, source: "MARKER" }));
  return app;
};

export default mod;
`;

const INDEX_HTML = `<!doctype html><title>custom</title>STATIC_MARKER`;

const waitForServer = async (
  base: string,
  retries = 20,
  delayMs = 150,
): Promise<void> => {
  for (let i = 0; i < retries; i++) {
    const ok = await fetch(`${base}/api/records`)
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) return;
    await Bun.sleep(delayMs);
  }
  // eslint-disable-next-line no-restricted-syntax
  throw new Error("HTTP server did not start in time");
};

describe("HTTP server with --static dir and colocated server.ts", () => {
  const PORT = 17_008;
  const BASE = `http://127.0.0.1:${PORT}`;
  let dir: string;
  let server: ChildProcess;

  beforeAll(async () => {
    dir = await setupWorkspace();
    const webDir = join(dir, "web");
    await mkdir(webDir, { recursive: true });
    await writeFile(join(webDir, "index.html"), INDEX_HTML);
    await writeFile(join(webDir, "server.ts"), SERVER_TS);

    server = spawn(
      "bun",
      ["run", CLI_ENTRY, "http", "--static", "./web", "--port", String(PORT)],
      { cwd: dir, stdio: "pipe" },
    );
    await waitForServer(BASE);
  }, 30_000);

  afterAll(async () => {
    server.kill();
    await teardownWorkspace(dir);
  });

  it("loads server.ts from the static dir and mounts custom routes", async () => {
    const res = await fetch(`${BASE}/api/custom`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; source: string };
    expect(body.ok).toBe(true);
    expect(body.source).toBe("MARKER");
  });

  it("does not serve server.ts as a static asset", async () => {
    const res = await fetch(`${BASE}/server.ts`);
    expect(res.status).toBe(404);
  });

  it("serves index.html from the static dir", async () => {
    const res = await fetch(`${BASE}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("STATIC_MARKER");
  });
});

describe("HTTP server with default .binder/web convention", () => {
  const PORT = 17_009;
  const BASE = `http://127.0.0.1:${PORT}`;
  let dir: string;
  let server: ChildProcess;

  beforeAll(async () => {
    dir = await setupWorkspace();
    const webDir = join(dir, ".binder", "web");
    await mkdir(webDir, { recursive: true });
    await writeFile(join(webDir, "index.html"), INDEX_HTML);
    await writeFile(join(webDir, "server.ts"), SERVER_TS);

    server = spawn("bun", ["run", CLI_ENTRY, "http", "--port", String(PORT)], {
      cwd: dir,
      stdio: "pipe",
    });
    await waitForServer(BASE);
  }, 30_000);

  afterAll(async () => {
    server.kill();
    await teardownWorkspace(dir);
  });

  it("loads server.ts from .binder/web by default", async () => {
    const res = await fetch(`${BASE}/api/custom`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; source: string };
    expect(body.ok).toBe(true);
    expect(body.source).toBe("MARKER");
  });

  it("does not serve server.ts as a static asset", async () => {
    const res = await fetch(`${BASE}/server.ts`);
    expect(res.status).toBe(404);
  });

  it("serves index.html from .binder/web", async () => {
    const res = await fetch(`${BASE}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("STATIC_MARKER");
  });
});
