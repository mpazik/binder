import { describe, it, expect } from "bun:test";
import {
  createError,
  errorChain,
  fail,
  formatError,
  isErrorObject,
  normalizeError,
  wrapError,
} from "./error.ts";
import { err, isErr, isOk, ok } from "./result.ts";

describe("createError", () => {
  it("creates error with key and message", () => {
    const error = createError("test-error", "something broke");
    expect(error).toEqual({ key: "test-error", message: "something broke" });
  });

  it("creates error with suggestion", () => {
    const error = createError("not-found", "File missing", {
      suggestion: "Run init first",
    });
    expect(error.suggestion).toBe("Run init first");
  });

  it("creates error with data", () => {
    const error = createError("parse-error", "Bad JSON", {
      data: { line: 42 },
    });
    expect(error.data).toEqual({ line: 42 });
  });

  it("omits undefined optional fields", () => {
    const error = createError("simple", "msg");
    expect("suggestion" in error).toBe(false);
    expect("data" in error).toBe(false);
    expect("cause" in error).toBe(false);
  });
});

describe("isErrorObject", () => {
  it("returns true for valid ErrorObject", () => {
    expect(isErrorObject({ key: "x", message: "y" })).toBe(true);
  });

  it("returns false for missing message", () => {
    expect(isErrorObject({ key: "x" })).toBe(false);
  });

  it("returns false for non-objects", () => {
    expect(isErrorObject(null)).toBe(false);
    expect(isErrorObject("string")).toBe(false);
    expect(isErrorObject(42)).toBe(false);
  });
});

describe("fail", () => {
  it("returns Err with ErrorObject", () => {
    const result = fail("bad-input", "Invalid email");
    expect(isErr(result)).toBe(true);
    expect(result.error.key).toBe("bad-input");
    expect(result.error.message).toBe("Invalid email");
  });

  it("passes options through", () => {
    const result = fail("missing-config", "No config file", {
      suggestion: "Run binder init",
      data: { path: "/foo" },
    });
    expect(result.error.suggestion).toBe("Run binder init");
    expect(result.error.data).toEqual({ path: "/foo" });
  });
});

describe("wrapError", () => {
  it("wraps with inherited key and sets cause", () => {
    const inner = fail("db-error", "Connection refused");
    const wrapped = wrapError(inner, "Failed to load data");
    expect(wrapped.error.key).toBe("db-error");
    expect(wrapped.error.message).toBe("Failed to load data");
    expect(wrapped.error.cause?.key).toBe("db-error");
    expect(wrapped.error.cause?.message).toBe("Connection refused");
  });

  it("wraps with new key and sets cause", () => {
    const inner = fail("db-error", "Connection refused");
    const wrapped = wrapError(inner, "init-failed", "Failed to initialize");
    expect(wrapped.error.key).toBe("init-failed");
    expect(wrapped.error.message).toBe("Failed to initialize");
    expect(wrapped.error.cause?.key).toBe("db-error");
  });

  it("wraps a plain Error", () => {
    const jsError = new Error("ENOENT");
    const wrapped = wrapError(jsError, "file-error", "Could not read file");
    expect(wrapped.error.key).toBe("file-error");
    expect(wrapped.error.cause?.message).toBe("ENOENT");
  });

  it("accepts options with suggestion", () => {
    const inner = fail("parse-error", "Bad syntax");
    const wrapped = wrapError(inner, "config-error", "Invalid config", {
      suggestion: "Check your YAML syntax",
    });
    expect(wrapped.error.suggestion).toBe("Check your YAML syntax");
    expect(wrapped.error.cause?.key).toBe("parse-error");
  });
});

describe("errorChain", () => {
  it("returns single key for error without cause", () => {
    const error = createError("simple", "msg");
    expect(errorChain(error)).toEqual(["simple"]);
  });

  it("returns chain of keys", () => {
    const inner = createError("db-error", "Connection failed");
    const middle = {
      ...createError("repo-error", "Query failed"),
      cause: inner,
    };
    const outer = {
      ...createError("api-error", "Request failed"),
      cause: middle,
    };
    expect(errorChain(outer)).toEqual(["api-error", "repo-error", "db-error"]);
  });
});

describe("formatError", () => {
  it("formats simple error", () => {
    const error = createError("test", "Something broke");
    expect(formatError(error)).toBe("Error: Something broke");
  });

  it("formats error with suggestion", () => {
    const error = createError("missing-config", "No config file", {
      suggestion: "Run binder init",
    });
    const output = formatError(error);
    expect(output).toContain("Error: No config file");
    expect(output).toContain("suggestion: Run binder init");
  });

  it("formats cause chain", () => {
    const inner = createError("db-error", "Connection refused");
    const outer = {
      ...createError("init-failed", "Failed to start"),
      cause: inner,
    };
    const output = formatError(outer);
    expect(output).toContain("Error: Failed to start");
    expect(output).toContain("cause: Connection refused");
  });
});

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

describe("isOk / isErr", () => {
  it("isOk returns true for ok result", () => {
    expect(isOk(ok(42))).toBe(true);
  });

  it("isOk returns false for err result", () => {
    expect(isOk(err("bad"))).toBe(false);
  });

  it("isErr returns true for err result", () => {
    expect(isErr(err("bad"))).toBe(true);
  });

  it("isErr returns false for ok result", () => {
    expect(isErr(ok(42))).toBe(false);
  });
});
