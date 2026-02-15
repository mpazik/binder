import { describe, expect, it } from "bun:test";
import "@binder/utils/tests";
import { createError, err } from "@binder/utils";
import type { FieldsetNested, FieldValue } from "@binder/db";
import { createFieldAccumulator } from "./field-accumulator.ts";
import type { FieldConflictSource } from "./field-accumulator.ts";

describe("field-accumulator", () => {
  const check = (
    base: FieldsetNested,
    sets: Array<{
      path: string[];
      value: FieldValue;
      source?: FieldConflictSource;
    }>,
    expected: FieldsetNested,
  ) => {
    const acc = createFieldAccumulator(base);
    for (const { path, value, source } of sets) {
      acc.set(path, value, source);
    }
    expect(acc.result()).toBeOkWith(expected);
  };

  const checkError = (
    base: FieldsetNested,
    sets: Array<{
      path: string[];
      value: FieldValue;
      source?: FieldConflictSource;
    }>,
    expected: {
      fieldPath: string[];
      values: Array<{ value: FieldValue; source: FieldConflictSource }>;
      baseValue: FieldValue;
    },
  ) => {
    const acc = createFieldAccumulator(base);
    for (const { path, value, source } of sets) {
      acc.set(path, value, source);
    }
    expect(acc.result()).toEqual(
      err(
        createError(
          "field-conflict",
          `Conflicting values for field '${expected.fieldPath.join(".")}'`,
          expected,
        ),
      ),
    );
  };

  describe("base comparison", () => {
    it("skips value matching base", () => {
      check({ title: "Hello" }, [{ path: ["title"], value: "Hello" }], {});
    });

    it("stores value differing from base", () => {
      check({ title: "Hello" }, [{ path: ["title"], value: "Updated" }], {
        title: "Updated",
      });
    });

    it("stores value when base has no such field", () => {
      check({}, [{ path: ["title"], value: "New" }], { title: "New" });
    });

    it("stores null when base has a value", () => {
      check({ title: "Hello" }, [{ path: ["title"], value: null }], {
        title: null,
      });
    });

    it("returns only changed fields (sparse)", () => {
      check(
        { title: "Hello", status: "active", description: "Some text" },
        [
          { path: ["title"], value: "Hello" },
          { path: ["status"], value: "done" },
          { path: ["description"], value: "Some text" },
        ],
        { status: "done" },
      );
    });

    it("skips object value matching base via deep equality", () => {
      check(
        { meta: { tags: ["a", "b"] } },
        [{ path: ["meta"], value: { tags: ["a", "b"] } }],
        {},
      );
    });
  });

  describe("nested paths", () => {
    it("stores nested field differing from base", () => {
      check(
        { parent: { plan: "old plan" } },
        [{ path: ["parent", "plan"], value: "new plan" }],
        { parent: { plan: "new plan" } },
      );
    });

    it("skips nested value matching base", () => {
      check(
        { parent: { plan: "same" } },
        [{ path: ["parent", "plan"], value: "same" }],
        {},
      );
    });

    it("preserves nested path when parent path is set after", () => {
      check(
        {},
        [
          { path: ["assignee", "email"], value: "new@co" },
          { path: ["assignee"], value: { name: "Alice" } },
        ],
        { assignee: { name: "Alice", email: "new@co" } },
      );
    });

    it("preserves parent object when nested path is set after", () => {
      check(
        {},
        [
          { path: ["assignee"], value: { name: "Alice" } },
          { path: ["assignee", "email"], value: "new@co" },
        ],
        { assignee: { name: "Alice", email: "new@co" } },
      );
    });
  });

  describe("duplicate sets", () => {
    it("skips duplicate set with same value (idempotent)", () => {
      check(
        { title: "Hello" },
        [
          { path: ["title"], value: "Updated", source: { origin: "body" } },
          {
            path: ["title"],
            value: "Updated",
            source: { origin: "frontmatter" },
          },
        ],
        { title: "Updated" },
      );
    });

    it("detects conflict when same field set with different values", () => {
      checkError(
        { title: "Hello" },
        [
          { path: ["title"], value: "Value A", source: { origin: "body" } },
          {
            path: ["title"],
            value: "Value B",
            source: { origin: "frontmatter" },
          },
        ],
        {
          fieldPath: ["title"],
          values: [
            { value: "Value A", source: { origin: "body" } },
            { value: "Value B", source: { origin: "frontmatter" } },
          ],
          baseValue: "Hello",
        },
      );
    });
  });

  describe("frontmatter + body overlap", () => {
    it("preserves body edit when frontmatter matches base", () => {
      check(
        { title: "My Task", status: "active" },
        [
          { path: ["status"], value: "done", source: { origin: "body" } },
          {
            path: ["status"],
            value: "active",
            source: { origin: "frontmatter" },
          },
        ],
        { status: "done" },
      );
    });

    it("skips both when neither changed from base", () => {
      check(
        { title: "My Task", status: "active" },
        [
          { path: ["status"], value: "active", source: { origin: "body" } },
          {
            path: ["status"],
            value: "active",
            source: { origin: "frontmatter" },
          },
        ],
        {},
      );
    });
  });

  describe("duplicate slot conflict", () => {
    it("detects conflict when duplicate slots have different values", () => {
      checkError(
        { plan: "Original plan" },
        [
          { path: ["plan"], value: "Plan A", source: { origin: "body" } },
          {
            path: ["plan"],
            value: "Plan B",
            source: { origin: "body:duplicate" },
          },
        ],
        {
          fieldPath: ["plan"],
          values: [
            { value: "Plan A", source: { origin: "body" } },
            { value: "Plan B", source: { origin: "body:duplicate" } },
          ],
          baseValue: "Original plan",
        },
      );
    });

    it("allows duplicate slots when values match", () => {
      check(
        { plan: "Original plan" },
        [
          {
            path: ["plan"],
            value: "Updated plan",
            source: { origin: "body" },
          },
          {
            path: ["plan"],
            value: "Updated plan",
            source: { origin: "body:duplicate" },
          },
        ],
        { plan: "Updated plan" },
      );
    });
  });
});
