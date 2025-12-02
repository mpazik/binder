import { describe, expect, it } from "bun:test";
import { matchesFilter, matchesFilters } from "./filter-entities.ts";

describe("filter-entities", () => {
  describe("matchesFilter", () => {
    const check = (
      filter: Parameters<typeof matchesFilter>[0],
      value: Parameters<typeof matchesFilter>[1],
      expected: boolean,
    ) => {
      expect(matchesFilter(filter, value)).toBe(expected);
    };

    describe("simple filter (equality)", () => {
      it("matches equal string", () => check("relation", "relation", true));

      it("does not match different string", () =>
        check("relation", "string", false));

      it("matches equal number", () => check(42, 42, true));

      it("matches equal boolean", () => check(true, true, true));

      it("matches null filter with null value", () =>
        check(null as never, null, true));
    });

    describe("eq operator", () => {
      it("matches equal value", () =>
        check({ op: "eq", value: "relation" }, "relation", true));

      it("does not match different value", () =>
        check({ op: "eq", value: "relation" }, "string", false));
    });

    describe("not operator", () => {
      it("matches different value", () =>
        check({ op: "not", value: "relation" }, "string", true));

      it("does not match equal value", () =>
        check({ op: "not", value: "relation" }, "relation", false));
    });

    describe("in operator", () => {
      it("matches value in array", () =>
        check({ op: "in", value: ["a", "b", "c"] }, "b", true));

      it("does not match value not in array", () =>
        check({ op: "in", value: ["a", "b", "c"] }, "d", false));

      it("works with numbers", () =>
        check({ op: "in", value: [1, 2, 3] }, 2, true));
    });

    describe("notIn operator", () => {
      it("matches value not in array", () =>
        check({ op: "notIn", value: ["a", "b", "c"] }, "d", true));

      it("does not match value in array", () =>
        check({ op: "notIn", value: ["a", "b", "c"] }, "b", false));
    });

    describe("contains operator", () => {
      it("matches substring", () =>
        check({ op: "contains", value: "hello" }, "say hello world", true));

      it("does not match missing substring", () =>
        check({ op: "contains", value: "goodbye" }, "hello world", false));
    });

    describe("notContains operator", () => {
      it("matches missing substring", () =>
        check({ op: "notContains", value: "goodbye" }, "hello world", true));

      it("does not match present substring", () =>
        check({ op: "notContains", value: "hello" }, "hello world", false));
    });

    describe("comparison operators", () => {
      it("lt matches lesser value", () => {
        check({ op: "lt", value: 10 }, 5, true);
        check({ op: "lt", value: 10 }, 10, false);
      });

      it("lte matches lesser or equal value", () => {
        check({ op: "lte", value: 10 }, 10, true);
        check({ op: "lte", value: 10 }, 11, false);
      });

      it("gt matches greater value", () => {
        check({ op: "gt", value: 10 }, 15, true);
        check({ op: "gt", value: 10 }, 10, false);
      });

      it("gte matches greater or equal value", () => {
        check({ op: "gte", value: 10 }, 10, true);
        check({ op: "gte", value: 10 }, 9, false);
      });
    });

    describe("empty operator", () => {
      it("matches null when checking for empty", () =>
        check({ op: "empty", value: true }, null, true));

      it("matches empty string when checking for empty", () =>
        check({ op: "empty", value: true }, "", true));

      it("does not match non-empty value when checking for empty", () =>
        check({ op: "empty", value: true }, "hello", false));

      it("matches non-empty value when checking for not empty", () =>
        check({ op: "empty", value: false }, "hello", true));
    });
  });

  describe("matchesFilters", () => {
    const check = (
      filters: Parameters<typeof matchesFilters>[0],
      record: Parameters<typeof matchesFilters>[1],
      expected: boolean,
    ) => {
      expect(matchesFilters(filters, record)).toBe(expected);
    };

    it("matches when all filters pass", () =>
      check(
        { dataType: "relation", status: "active" },
        { dataType: "relation", status: "active", name: "test" },
        true,
      ));

    it("does not match when one filter fails", () =>
      check(
        { dataType: "relation", status: "active" },
        { dataType: "relation", status: "inactive" },
        false,
      ));

    it("matches empty filters", () =>
      check({}, { dataType: "relation" }, true));

    it("works with complex filters", () =>
      check(
        { dataType: { op: "in", value: ["relation", "string"] } },
        { dataType: "relation" },
        true,
      ));
  });
});
