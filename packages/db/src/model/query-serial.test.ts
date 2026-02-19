import { describe, it, expect } from "bun:test";
import { throwIfError } from "@binder/utils";
import "@binder/utils/tests";
import type { Filters, Includes } from "./query.ts";
import {
  coerceFilterValue,
  parseSerialFilters,
  serializeFilters,
  parseSerialIncludes,
  serializeIncludes,
  parseSerialOrderBy,
  serializeOrderBy,
} from "./query-serial.ts";

describe("query-serial", () => {
  describe("coerceFilterValue", () => {
    const check = (input: string, expected: string | number | boolean) => {
      expect(coerceFilterValue(input)).toBe(expected);
    };

    it("coerces 'true' to boolean", () => check("true", true));
    it("coerces 'false' to boolean", () => check("false", false));
    it("coerces integer string", () => check("42", 42));
    it("coerces negative integer", () => check("-7", -7));
    it("coerces float string", () => check("3.14", 3.14));
    it("coerces negative float", () => check("-1.5", -1.5));
    it("keeps plain string", () => check("hello", "hello"));
    it("keeps string with digits prefix", () => check("42abc", "42abc"));
  });

  describe("parseSerialFilters", () => {
    const check = (parts: string[], expected: Filters) => {
      expect(parseSerialFilters(parts)).toEqual(expected);
    };

    describe("simple equality", () => {
      it("parses single filter", () => check(["type=Task"], { type: "Task" }));

      it("parses multiple filters", () =>
        check(["type=Task", "status=done"], { type: "Task", status: "done" }));

      it("coerces boolean value", () =>
        check(["favorite=true"], { favorite: true }));

      it("coerces integer value", () => check(["priority=3"], { priority: 3 }));

      it("coerces float value", () => check(["score=9.5"], { score: 9.5 }));

      it("handles value containing equals sign", () =>
        check(["title=a=b"], { title: "a=b" }));
    });

    describe("symbolic operators", () => {
      it("parses not-equal", () =>
        check(["status!=done"], { status: { op: "not", value: "done" } }));

      it("parses greater-than", () =>
        check(["priority>3"], { priority: { op: "gt", value: 3 } }));

      it("parses greater-than-or-equal", () =>
        check(["priority>=3"], { priority: { op: "gte", value: 3 } }));

      it("parses less-than", () =>
        check(["score<100"], { score: { op: "lt", value: 100 } }));

      it("parses less-than-or-equal", () =>
        check(["score<=50"], { score: { op: "lte", value: 50 } }));
    });

    describe("named operators", () => {
      it("parses :in with comma-separated values", () =>
        check(["status:in=open,in-progress"], {
          status: { op: "in", value: ["open", "in-progress"] },
        }));

      it("parses :in with numeric values", () =>
        check(["priority:in=1,2,3"], {
          priority: { op: "in", value: [1, 2, 3] },
        }));

      it("parses :notIn", () =>
        check(["status:notIn=archived,deleted"], {
          status: { op: "notIn", value: ["archived", "deleted"] },
        }));

      it("parses :match", () =>
        check(["title:match=urgent"], {
          title: { op: "match", value: "urgent" },
        }));

      it("parses :contains", () =>
        check(["title:contains=test"], {
          title: { op: "contains", value: "test" },
        }));

      it("parses :notContains", () =>
        check(["title:notContains=draft"], {
          title: { op: "notContains", value: "draft" },
        }));

      it("parses :empty", () =>
        check(["assignee:empty"], {
          assignee: { op: "empty", value: true },
        }));

      it("parses :notEmpty", () =>
        check(["assignee:notEmpty"], {
          assignee: { op: "empty", value: false },
        }));
    });

    describe("plain text ($text)", () => {
      it("collects plain text tokens", () =>
        check(["urgent", "bug"], { $text: "urgent bug" }));

      it("mixes plain text with filters", () =>
        check(["deployment", "issues", "type=Task"], {
          $text: "deployment issues",
          type: "Task",
        }));
    });

    describe("combined", () => {
      it("parses spec example 1", () =>
        check(["type=Task", "status=done", "priority>=3"], {
          type: "Task",
          status: "done",
          priority: { op: "gte", value: 3 },
        }));

      it("parses spec example 2", () =>
        check(
          [
            "status:in=open,in-progress",
            "title:match=urgent",
            "assignee:empty",
          ],
          {
            status: { op: "in", value: ["open", "in-progress"] },
            title: { op: "match", value: "urgent" },
            assignee: { op: "empty", value: true },
          },
        ));
    });

    describe("edge cases", () => {
      it("returns empty filters for empty input", () => check([], {}));

      it("skips whitespace-only tokens", () =>
        check(["  ", "type=Task"], { type: "Task" }));
    });
  });

  describe("serializeFilters", () => {
    const check = (filters: Filters, expected: string[]) => {
      expect(serializeFilters(filters)).toEqual(expected);
    };

    it("serializes simple equality", () =>
      check({ type: "Task" }, ["type=Task"]));

    it("serializes boolean value", () =>
      check({ favorite: true }, ["favorite=true"]));

    it("serializes numeric value", () =>
      check({ priority: 3 }, ["priority=3"]));

    it("serializes not-equal", () =>
      check({ status: { op: "not", value: "done" } }, ["status!=done"]));

    it("serializes gte", () =>
      check({ priority: { op: "gte", value: 3 } }, ["priority>=3"]));

    it("serializes in", () =>
      check({ status: { op: "in", value: ["open", "done"] } }, [
        "status:in=open,done",
      ]));

    it("serializes empty true", () =>
      check({ assignee: { op: "empty", value: true } }, ["assignee:empty"]));

    it("serializes empty false", () =>
      check({ assignee: { op: "empty", value: false } }, [
        "assignee:notEmpty",
      ]));

    it("serializes match", () =>
      check({ title: { op: "match", value: "urgent" } }, [
        "title:match=urgent",
      ]));

    it("serializes $text as plain text", () =>
      check({ $text: "urgent bug", type: "Task" }, [
        "urgent bug",
        "type=Task",
      ]));

    it("serializes array value as :in", () =>
      check({ tags: ["a", "b"] }, ["tags:in=a,b"]));

    describe("round-trip", () => {
      const checkRoundTrip = (filters: Filters) => {
        expect(parseSerialFilters(serializeFilters(filters))).toEqual(filters);
      };

      it("simple equality", () =>
        checkRoundTrip({ type: "Task", status: "done" }));

      it("numeric", () => checkRoundTrip({ priority: 3 }));

      it("complex operators", () =>
        checkRoundTrip({
          status: { op: "not", value: "done" },
          priority: { op: "gte", value: 3 },
        }));

      it("in operator", () =>
        checkRoundTrip({ status: { op: "in", value: ["open", "done"] } }));

      it("empty operator", () =>
        checkRoundTrip({ assignee: { op: "empty", value: true } }));
    });
  });

  describe("parseSerialIncludes", () => {
    const check = (input: string, expected: Includes) => {
      expect(parseSerialIncludes(input)).toBeOkWith(expected);
    };

    const checkError = (input: string, errorKey: string) => {
      expect(parseSerialIncludes(input)).toBeErrWithKey(errorKey);
    };

    describe("flat fields", () => {
      it("parses single field", () => check("title", { title: true }));

      it("parses multiple fields", () =>
        check("title,status,tags", {
          title: true,
          status: true,
          tags: true,
        }));
    });

    describe("nested fields", () => {
      it("parses single nested field", () =>
        check("project(title)", { project: { title: true } }));

      it("parses nested with multiple sub-fields", () =>
        check("project(title,status)", {
          project: { title: true, status: true },
        }));

      it("parses deeply nested", () =>
        check("project(owner(name,email))", {
          project: { owner: { name: true, email: true } },
        }));

      it("parses spec example", () =>
        check(
          "project(title,owner(name,email)),comments(body,author(name)),tags",
          {
            project: { title: true, owner: { name: true, email: true } },
            comments: { body: true, author: { name: true } },
            tags: true,
          },
        ));
    });

    describe("whitespace", () => {
      it("trims outer whitespace", () => check("  title  ", { title: true }));

      it("handles whitespace around commas", () =>
        check("title , status , tags", {
          title: true,
          status: true,
          tags: true,
        }));

      it("handles whitespace around parentheses", () =>
        check("project( title , status )", {
          project: { title: true, status: true },
        }));

      it("handles whitespace in nested", () =>
        check("project( title , owner( name , email ) ) , tags", {
          project: { title: true, owner: { name: true, email: true } },
          tags: true,
        }));
    });

    describe("field names with underscore and digits", () => {
      it("parses field with underscore", () =>
        check("my_field", { my_field: true }));

      it("parses field starting with underscore", () =>
        check("_private", { _private: true }));

      it("parses field with digits", () => check("field2", { field2: true }));
    });

    describe("errors", () => {
      it("rejects empty string", () => checkError("", "empty-includes"));

      it("rejects whitespace-only", () => checkError("   ", "empty-includes"));

      it("rejects unmatched opening paren", () =>
        checkError("project(title", "unmatched-paren"));

      it("rejects unmatched closing paren", () =>
        checkError("project)title", "unmatched-paren"));

      it("rejects empty field name between commas", () =>
        checkError("title,,status", "empty-field-name"));

      it("rejects trailing comma", () =>
        checkError("title,", "empty-field-name"));
    });
  });

  describe("serializeIncludes", () => {
    const check = (includes: Includes, expected: string) => {
      expect(serializeIncludes(includes)).toBe(expected);
    };

    it("serializes flat fields", () =>
      check({ title: true, status: true }, "title,status"));

    it("serializes nested fields", () =>
      check(
        { project: { title: true, status: true } },
        "project(title,status)",
      ));

    it("serializes deeply nested", () =>
      check(
        { project: { title: true, owner: { name: true } }, tags: true },
        "project(title,owner(name)),tags",
      ));

    it("skips false values", () =>
      check({ title: true, hidden: false }, "title"));

    describe("round-trip", () => {
      const checkRoundTrip = (input: string) => {
        const parsed = throwIfError(parseSerialIncludes(input));
        expect(serializeIncludes(parsed)).toBe(input);
      };

      it("flat fields", () => checkRoundTrip("title,status,tags"));

      it("nested", () =>
        checkRoundTrip("project(title,owner(name,email)),tags"));

      it("single field", () => checkRoundTrip("title"));

      it("single nested", () => checkRoundTrip("project(title)"));
    });
  });

  describe("parseSerialOrderBy", () => {
    const check = (input: string, expected: string[]) => {
      expect(parseSerialOrderBy(input)).toEqual(expected);
    };

    it("parses ascending field", () => check("createdAt", ["createdAt"]));

    it("parses descending field", () => check("!priority", ["!priority"]));

    it("parses multiple fields", () =>
      check("!priority,createdAt", ["!priority", "createdAt"]));

    it("handles whitespace", () =>
      check(" !priority , createdAt ", ["!priority", "createdAt"]));

    it("filters empty segments", () =>
      check("!priority,,createdAt", ["!priority", "createdAt"]));
  });

  describe("serializeOrderBy", () => {
    const check = (orderBy: string[], expected: string) => {
      expect(serializeOrderBy(orderBy)).toBe(expected);
    };

    it("serializes order fields", () =>
      check(["!priority", "createdAt"], "!priority,createdAt"));

    it("round-trips", () => {
      const input = "!priority,createdAt";
      expect(serializeOrderBy(parseSerialOrderBy(input))).toBe(input);
    });
  });
});
