import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mapExceptionList, resolveCommandName, track } from "./telemetry.ts";

describe("telemetry", () => {
  describe("resolveCommandName", () => {
    it("redacts positional arguments", () => {
      expect(resolveCommandName(["read", "task-secret-key"])).toBe("read");
      expect(resolveCommandName(["docs", "sync", "private-query"])).toBe(
        "docs sync",
      );
      expect(resolveCommandName(["tx", "import", "records.yaml"])).toBe(
        "transaction import",
      );
    });
  });

  describe("mapExceptionList", () => {
    it("preserves cause chain order", () => {
      expect(
        mapExceptionList(
          {
            key: "outer",
            message: "outer message",
            cause: {
              key: "inner",
              message: "inner message",
            },
          },
          true,
        ),
      ).toEqual([
        {
          type: "outer",
          value: "outer",
          mechanism: { handled: true, synthetic: false },
        },
        {
          type: "inner",
          value: "inner",
          mechanism: { handled: true, synthetic: false },
        },
      ]);
    });
  });

  describe("track", () => {
    let stateHome: string;
    let previousStateHome: string | undefined;

    beforeEach(async () => {
      previousStateHome = process.env.XDG_STATE_HOME;
      stateHome = await mkdtemp(join(tmpdir(), "binder-telemetry-"));
      process.env.XDG_STATE_HOME = stateHome;
    });

    afterEach(async () => {
      if (previousStateHome === undefined) {
        delete process.env.XDG_STATE_HOME;
      } else {
        process.env.XDG_STATE_HOME = previousStateHome;
      }

      await rm(stateHome, { recursive: true, force: true });
    });

    it("appends JSONL lines when enabled", async () => {
      track(
        {
          enabled: true,
          isInternal: false,
          reason: "enabled",
          key: "test-key",
          host: "https://us.i.posthog.com",
        },
        {
          event: "cli.search",
          success: true,
          duration_ms: 12,
        },
      );

      const usagePath = join(stateHome, "binder", "usage.jsonl");
      const usage = await readFile(usagePath, "utf-8");
      const lines = usage.trim().split("\n");
      expect(lines).toEqual([expect.any(String)]);

      const payload = JSON.parse(lines[0] as string);
      expect(payload).toMatchObject({
        event: "cli.search",
        success: true,
        duration_ms: 12,
      });
      expect(typeof payload.timestamp).toBe("number");
      expect(typeof payload.tty).toBe("boolean");
    });
  });
});
