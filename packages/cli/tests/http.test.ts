import { type ChildProcess, spawn } from "node:child_process";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { setupWorkspace, teardownWorkspace } from "./setup.ts";

const REPO_ROOT = new URL("../../..", import.meta.url).pathname;
const CLI_ENTRY = `${REPO_ROOT}/packages/cli/src/index.ts`;
const PORT = 17_007;
const BASE = `http://127.0.0.1:${PORT}`;

const waitForServer = async (retries = 20, delayMs = 150): Promise<void> => {
  for (let i = 0; i < retries; i++) {
    const ok = await fetch(`${BASE}/api/records`)
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) return;
    await Bun.sleep(delayMs);
  }
  // eslint-disable-next-line no-restricted-syntax
  throw new Error("HTTP server did not start in time");
};

const post = (path: string, body: unknown) =>
  fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("HTTP server", () => {
  let dir: string;
  let server: ChildProcess;

  beforeAll(async () => {
    dir = await setupWorkspace();
    server = spawn("bun", ["run", CLI_ENTRY, "http", "--port", String(PORT)], {
      cwd: dir,
      stdio: "pipe",
    });
    await waitForServer();
  }, 30_000);

  afterAll(async () => {
    server.kill();
    await teardownWorkspace(dir);
  });

  describe("GET /api/config", () => {
    it("returns config items including seeded types", async () => {
      const res = await fetch(`${BASE}/api/config`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        items: { type: string; key: string }[];
      };
      expect(body.items.length).toBeGreaterThan(0);
      const keys = body.items.map((i) => i.key);
      expect(keys).toContain("Task");
      expect(keys).toContain("Project");
    });
  });

  describe("GET /api/config/:ref", () => {
    it("returns a single config record by key", async () => {
      const res = await fetch(`${BASE}/api/config/Task`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.key).toBe("Task");
    });

    it("returns 404 for unknown ref", async () => {
      const res = await fetch(`${BASE}/api/config/nonexistent-xyz`);
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/records", () => {
    it("returns all records when no filters given", async () => {
      const res = await fetch(`${BASE}/api/records`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        items: unknown[];
        pagination: unknown;
      };
      expect(body.items.length).toBeGreaterThan(0);
      expect(body.pagination).toBeDefined();
    });

    it("filters by type", async () => {
      const res = await fetch(`${BASE}/api/records?type=Task`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: { type: string }[] };
      expect(body.items.length).toBeGreaterThan(0);
      for (const item of body.items) expect(item.type).toBe("Task");
    });

    it("respects limit", async () => {
      const res = await fetch(`${BASE}/api/records?limit=1`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: unknown[] };
      expect(body.items.length).toBe(1);
    });

    it("combines multiple filters", async () => {
      const res = await fetch(`${BASE}/api/records?type=Task&status=pending`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        items: { type: string; status: string }[];
      };
      for (const item of body.items) {
        expect(item.type).toBe("Task");
        expect(item.status).toBe("pending");
      }
    });
  });

  describe("GET /api/records/:ref", () => {
    it("returns a single record by key", async () => {
      const list = await fetch(`${BASE}/api/records?type=Task&limit=1`).then(
        (r) => r.json() as Promise<{ items: { key: string; title: string }[] }>,
      );
      const { key, title } = list.items[0]!;

      const res = await fetch(`${BASE}/api/records/${key}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { key: string; title: string };
      expect(body.key).toBe(key);
      expect(body.title).toBe(title);
    });

    it("returns 404 for unknown ref", async () => {
      const res = await fetch(`${BASE}/api/records/no-such-record-xyz`);
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/transactions", () => {
    it("creates a record and returns the transaction", async () => {
      const res = await post("/api/transactions", {
        records: [
          { type: "Task", key: "http-created", title: "Created via HTTP" },
        ],
      });
      expect(res.status).toBe(201);
      const tx = (await res.json()) as {
        id: number;
        records: Record<string, unknown>;
      };
      expect(tx.id).toBeGreaterThan(0);
      expect(Object.keys(tx.records).length).toBe(1);
    });

    it("persists the record — readable via GET", async () => {
      const res = await fetch(`${BASE}/api/records/http-created`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { title: string };
      expect(body.title).toBe("Created via HTTP");
    });

    it("updates an existing record", async () => {
      await post("/api/transactions", {
        records: [{ key: "http-created", title: "Updated via HTTP" }],
      });
      const res = await fetch(`${BASE}/api/records/http-created`);
      const body = (await res.json()) as { title: string };
      expect(body.title).toBe("Updated via HTTP");
    });

    it("returns 400 for invalid body", async () => {
      const res = await post("/api/transactions", "not an object");
      expect(res.status).toBe(400);
    });
  });

  describe("GET / (built-in record browser)", () => {
    it("serves the index.html", async () => {
      const res = await fetch(`${BASE}/`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      const html = await res.text();
      expect(html).toContain("<title>Binder</title>");
      expect(html).toContain('src="/app.js"');
    });
  });
});
