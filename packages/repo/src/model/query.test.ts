import { describe, it, expect } from "bun:test";
import type { FieldsetNested } from "./field.ts";
import {
  type Includes,
  includesWithUid,
  mergeIncludes,
  pickByIncludes,
} from "./query.ts";

describe("includesWithUid", () => {
  const check = (input: Includes, expected: Includes) => {
    expect(includesWithUid(input)).toEqual(expected);
  };

  it("adds uid to top level", () =>
    check({ title: true }, { uid: true, title: true }));

  it("adds uid to nested includes", () =>
    check(
      { tasks: { title: true } },
      { uid: true, tasks: { uid: true, title: true } },
    ));

  it("adds uid to deeply nested includes", () =>
    check(
      { tasks: { title: true, assignee: { name: true } } },
      {
        uid: true,
        tasks: { uid: true, title: true, assignee: { uid: true, name: true } },
      },
    ));

  it("handles nested includes with filters", () =>
    check(
      { tasks: { includes: { title: true }, filters: { status: "active" } } },
      {
        uid: true,
        tasks: {
          includes: { uid: true, title: true },
          filters: { status: "active" },
        },
      },
    ));

  it("adds uid to nested includes object without explicit includes key", () =>
    check(
      { tasks: { filters: { status: "active" } } },
      {
        uid: true,
        tasks: { includes: { uid: true }, filters: { status: "active" } },
      },
    ));
});

describe("mergeIncludes", () => {
  const check = (
    a: Includes | undefined,
    b: Includes | undefined,
    expected: Includes | undefined,
  ) => {
    expect(mergeIncludes(a, b)).toEqual(expected);
  };

  it("returns undefined when both are undefined", () =>
    check(undefined, undefined, undefined));

  it("returns a when b is undefined", () =>
    check({ title: true }, undefined, { title: true }));

  it("returns b when a is undefined", () =>
    check(undefined, { title: true }, { title: true }));

  it("merges non-overlapping keys", () =>
    check({ title: true }, { status: true }, { title: true, status: true }));

  it("merges nested objects recursively", () =>
    check(
      { parent: { weekPeriod: true } },
      { parent: { plan: true } },
      { parent: { weekPeriod: true, plan: true } },
    ));

  it("injects key and uid when merging object with true", () =>
    check(
      { parent: { weekPeriod: true, plan: true } },
      { parent: true },
      { parent: { key: true, uid: true, weekPeriod: true, plan: true } },
    ));

  it("injects key and uid when merging true with object", () =>
    check(
      { parent: true },
      { parent: { weekPeriod: true, plan: true } },
      { parent: { key: true, uid: true, weekPeriod: true, plan: true } },
    ));

  it("overwrites boolean with boolean", () =>
    check({ title: false }, { title: true }, { title: true }));
});

describe("pickByIncludes", () => {
  const check = (
    entity: FieldsetNested,
    includes: Includes,
    expected: FieldsetNested,
  ) => {
    expect(pickByIncludes(entity, includes)).toEqual(expected);
  };

  it("picks scalar fields", () =>
    check(
      { title: "My Task", status: "active", priority: "high" },
      { title: true, status: true },
      { title: "My Task", status: "active" },
    ));

  it("collapses relation object to key", () =>
    check(
      {
        title: "Day Entry",
        parent: { key: "jw-2026-W07", uid: "abc", weekPeriod: "2026-W07" },
      },
      { title: true, parent: true },
      { title: "Day Entry", parent: "jw-2026-W07" },
    ));

  it("collapses relation object to uid when no key", () =>
    check(
      { title: "Day Entry", parent: { uid: "abc", weekPeriod: "2026-W07" } },
      { title: true, parent: true },
      { title: "Day Entry", parent: "abc" },
    ));

  it("picks nested fields from relation object", () =>
    check(
      {
        parent: {
          key: "jw-2026-W07",
          uid: "abc",
          weekPeriod: "2026-W07",
          plan: "Do stuff",
        },
      },
      { parent: { weekPeriod: true } },
      { parent: { weekPeriod: "2026-W07" } },
    ));

  it("collapses array of relation objects to keys", () =>
    check(
      {
        tasks: [
          { key: "task-1", uid: "u1", title: "First" },
          { key: "task-2", uid: "u2", title: "Second" },
        ],
      },
      { tasks: true },
      { tasks: ["task-1", "task-2"] },
    ));

  it("picks nested fields from array of relation objects", () =>
    check(
      {
        tasks: [
          { key: "task-1", uid: "u1", title: "First", status: "active" },
          { key: "task-2", uid: "u2", title: "Second", status: "done" },
        ],
      },
      { tasks: { title: true } },
      { tasks: [{ title: "First" }, { title: "Second" }] },
    ));

  it("skips null and undefined values", () =>
    check(
      { title: "My Task", description: null },
      { title: true, description: true },
      { title: "My Task" },
    ));

  it("skips fields with false includes", () =>
    check(
      { title: "My Task", status: "active" },
      { title: true, status: false },
      { title: "My Task" },
    ));

  it("handles deeply nested includes", () =>
    check(
      {
        parent: {
          key: "jw-2026-W07",
          uid: "abc",
          grandparent: {
            key: "jm-2026-02",
            uid: "def",
            monthPeriod: "2026-02",
          },
        },
      },
      { parent: { grandparent: { monthPeriod: true } } },
      { parent: { grandparent: { monthPeriod: "2026-02" } } },
    ));

  it("collapses deeply nested relation to key", () =>
    check(
      {
        parent: {
          key: "jw-2026-W07",
          uid: "abc",
          grandparent: {
            key: "jm-2026-02",
            uid: "def",
            monthPeriod: "2026-02",
          },
        },
      },
      { parent: { grandparent: true } },
      { parent: { grandparent: "jm-2026-02" } },
    ));

  it("keeps scalar values in arrays unchanged", () =>
    check({ tags: ["foo", "bar"] }, { tags: true }, { tags: ["foo", "bar"] }));
});
