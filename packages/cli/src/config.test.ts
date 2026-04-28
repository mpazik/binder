import { describe, expect, it } from "bun:test";
import { mergeLlmConfig, resolveLlmConfig } from "./config.ts";

describe("config", () => {
  describe("mergeLlmConfig", () => {
    it("returns undefined when both inputs are undefined", () => {
      expect(mergeLlmConfig(undefined, undefined)).toBeUndefined();
    });

    it("returns the workspace config unchanged when global is missing", () => {
      expect(
        mergeLlmConfig(undefined, {
          default: { provider: "anthropic", model: "claude-haiku-4-5" },
        }),
      ).toEqual({
        default: { provider: "anthropic", model: "claude-haiku-4-5" },
      });
    });

    it("workspace fields override global at the field level", () => {
      expect(
        mergeLlmConfig(
          { default: { provider: "anthropic", model: "claude-opus-4" } },
          { default: { model: "claude-haiku-4-5" } },
        ),
      ).toEqual({
        default: { provider: "anthropic", model: "claude-haiku-4-5" },
      });
    });

    it("merges per-operation entries from both sides", () => {
      expect(
        mergeLlmConfig(
          { operations: { ingest: { provider: "anthropic", model: "x" } } },
          { operations: { organize: { provider: "openai", model: "y" } } },
        ),
      ).toEqual({
        operations: {
          ingest: { provider: "anthropic", model: "x" },
          organize: { provider: "openai", model: "y" },
        },
      });
    });

    it("workspace overrides shared per-operation fields", () => {
      expect(
        mergeLlmConfig(
          {
            operations: { ingest: { provider: "anthropic", model: "haiku" } },
          },
          { operations: { ingest: { model: "haiku-4-5" } } },
        ),
      ).toEqual({
        operations: {
          ingest: { provider: "anthropic", model: "haiku-4-5" },
        },
      });
    });
  });

  describe("resolveLlmConfig", () => {
    it("returns null for missing config", () => {
      expect(resolveLlmConfig(undefined, "ingest")).toBeNull();
    });

    it("returns null when neither default nor operation is complete", () => {
      expect(
        resolveLlmConfig({ default: { provider: "anthropic" } }, "ingest"),
      ).toBeNull();
    });

    it("returns default when no operation entry exists", () => {
      expect(
        resolveLlmConfig(
          { default: { provider: "anthropic", model: "haiku" } },
          "ingest",
        ),
      ).toEqual({ provider: "anthropic", model: "haiku" });
    });

    it("operation overrides default field-by-field", () => {
      expect(
        resolveLlmConfig(
          {
            default: { provider: "anthropic", model: "haiku" },
            operations: { organize: { model: "opus" } },
          },
          "organize",
        ),
      ).toEqual({ provider: "anthropic", model: "opus" });
    });

    it("operation can fully replace default", () => {
      expect(
        resolveLlmConfig(
          {
            default: { provider: "anthropic", model: "haiku" },
            operations: { organize: { provider: "openai", model: "gpt-5" } },
          },
          "organize",
        ),
      ).toEqual({ provider: "openai", model: "gpt-5" });
    });
  });
});
