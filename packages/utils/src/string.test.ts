import { describe, expect, it } from "bun:test";
import { findSimilar, levenshteinSimilarity } from "./string.ts";

describe("levenshteinSimilarity", () => {
  it("returns 1 for identical strings", () => {
    expect(levenshteinSimilarity("hello", "hello")).toBe(1);
  });

  it("returns 0 for completely different strings", () => {
    expect(levenshteinSimilarity("abc", "xyz")).toBe(0);
  });

  it("returns 0 for empty strings", () => {
    expect(levenshteinSimilarity("", "hello")).toBe(0);
    expect(levenshteinSimilarity("hello", "")).toBe(0);
  });

  it("calculates similarity for similar strings", () => {
    expect(levenshteinSimilarity("kitten", "sitting")).toBeCloseTo(0.57, 1);
    expect(levenshteinSimilarity("actor", "aktor")).toBeCloseTo(0.8, 1);
  });
});

describe("findSimilar", () => {
  const defaultList = [
    "actor",
    "action",
    "status",
    "title",
    "description",
    "tags",
    "priority",
    "factor",
  ];

  const check = (
    phrase: string,
    expected: string[],
    opts?: { threshold?: number; max?: number; list?: string[] },
  ) => {
    const list = opts?.list ?? defaultList;
    const result = findSimilar(list, phrase, opts);
    expect(result.map((r) => r.value)).toEqual(expected);
  };

  it("finds exact match", () => {
    check("actor", ["actor", "factor", "action"]);
  });

  it("finds close typos", () => {
    check("aktor", ["actor", "factor"]);
  });

  it("finds transposed letters", () => {
    check("titel", []);
  });

  it("finds missing letters", () => {
    check("stauts", ["status"]);
  });

  it("finds extra letters", () => {
    check("actosr", ["actor", "factor"]);
  });

  it("respects threshold by returning only matches above it", () => {
    check("act", ["actor", "action", "factor"], { threshold: 0.5, max: 3 });
  });

  it("returns empty for garbage input", () => {
    check("xyz", []);
  });

  it("respects max limit", () => {
    check("actor", ["actor", "factor"], { max: 2 });
  });

  it("handles case insensitivity", () => {
    check("ACTOR", ["actor", "factor"], {
      list: ["actor", "action", "factor"],
      max: 2,
    });
  });

  it("returns empty array for empty list", () => {
    check("test", [], { list: [] });
  });

  it("returns all matches above threshold", () => {
    const result = findSimilar(
      ["actor", "factor", "tractor", "reactor"],
      "actor",
      { threshold: 0.6 },
    );

    expect(result.map((r) => r.value)).toEqual([
      "actor",
      "factor",
      "reactor",
      "tractor",
    ]);
  });

  it("sorts by similarity descending", () => {
    const result = findSimilar(["zappl", "apply", "apple", "maple"], "appl");

    expect(result.map((r) => r.value)).toEqual(["apple", "apply", "zappl"]);
  });
});
