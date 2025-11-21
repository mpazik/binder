import { describe, it, expect } from "bun:test";
import { createError, normalizeError } from "./error.ts";
import { err } from "./result.ts";

describe("normalizeError", () => {
  it("returns ErrorObject as-is", () => {
    const error = createError("test-error", "Test message");
    expect(normalizeError(error)).toBe(error);
  });

  it("extracts ErrorObject from Result", () => {
    const error = createError("test-error", "Test message");
    const result = err(error);
    expect(normalizeError(result)).toBe(error);
  });

  it("converts Error to ErrorObject", () => {
    const error = new Error("Test error");
    const normalized = normalizeError(error);
    expect(normalized.key).toBe("Error");
    expect(normalized.message).toBe("Test error");
  });

  it("converts unknown to ErrorObject", () => {
    const normalized = normalizeError("string error");
    expect(normalized.key).toBe("unknown");
    expect(normalized.message).toBe("string error");
  });

  it("handles null and undefined", () => {
    const normalizedNull = normalizeError(null);
    expect(normalizedNull.key).toBe("unknown");

    const normalizedUndefined = normalizeError(undefined);
    expect(normalizedUndefined.key).toBe("unknown");
  });
});
