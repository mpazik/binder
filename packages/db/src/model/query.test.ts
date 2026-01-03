import { describe, it, expect } from "bun:test";
import { type Includes, includesWithUid } from "./query.ts";

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
