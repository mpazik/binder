import { describe, it, expect } from "bun:test";
import { applySelection } from "./selection.ts";

describe("applySelection", () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it("returns all items when no selection args provided", () => {
    expect(applySelection(items, {})).toEqual(items);
  });

  it("returns first N items with limit", () => {
    expect(applySelection(items, { limit: 4 })).toEqual([1, 2, 3, 4]);
  });

  it("returns last N items with last", () => {
    expect(applySelection(items, { last: 3 })).toEqual([8, 9, 10]);
  });

  it("skips first N items with skip", () => {
    expect(applySelection(items, { skip: 3 })).toEqual([4, 5, 6, 7, 8, 9, 10]);
  });

  it("combines skip and limit for range selection", () => {
    expect(applySelection(items, { skip: 2, limit: 5 })).toEqual([
      3, 4, 5, 6, 7,
    ]);
  });

  it("handles limit larger than array length", () => {
    expect(applySelection(items, { limit: 100 })).toEqual(items);
  });

  it("handles last larger than array length", () => {
    expect(applySelection(items, { last: 100 })).toEqual(items);
  });

  it("handles skip larger than array length", () => {
    expect(applySelection(items, { skip: 100 })).toEqual([]);
  });

  it("handles empty array", () => {
    expect(applySelection([], { limit: 5 })).toEqual([]);
    expect(applySelection([], { last: 5 })).toEqual([]);
    expect(applySelection([], { skip: 5 })).toEqual([]);
  });
});
