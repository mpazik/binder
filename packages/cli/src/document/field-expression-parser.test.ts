import { describe, it, expect } from "bun:test";
import {
  parseFieldExpression,
  type FieldExpression,
  type Props,
} from "./field-expression-parser.ts";

describe("parseFieldExpression", () => {
  const check = (input: string, expected: FieldExpression<Props>) => {
    expect(parseFieldExpression(input)).toEqual({ data: expected });
  };

  const checkError = (input: string, errorKey: string) => {
    expect(parseFieldExpression(input)).toMatchObject({
      error: { key: errorKey },
    });
  };

  describe("path parsing", () => {
    it("parses simple path", () => check("title", { path: ["title"] }));

    it("parses nested path", () =>
      check("project.title", { path: ["project", "title"] }));

    it("parses deeply nested path", () =>
      check("parent.child.grandchild", {
        path: ["parent", "child", "grandchild"],
      }));

    it("parses global access with all keyword", () =>
      check("all.nodes", { path: ["all", "nodes"] }));
  });

  describe("whitespace handling", () => {
    it("trims leading whitespace", () => check("  title", { path: ["title"] }));

    it("trims trailing whitespace", () =>
      check("title  ", { path: ["title"] }));

    it("trims both leading and trailing whitespace", () =>
      check("  title  ", { path: ["title"] }));

    it("trims whitespace with nested path", () =>
      check("  author.name  ", { path: ["author", "name"] }));
  });

  describe("property syntax", () => {
    it("parses single property without args", () =>
      check("title | upper", { path: ["title"], props: { upper: true } }));

    it("parses property with string argument", () =>
      check('date | format: "YYYY-MM-DD"', {
        path: ["date"],
        props: { format: "YYYY-MM-DD" },
      }));

    it("parses property with single-quoted string argument", () =>
      check("date | format: 'YYYY-MM-DD'", {
        path: ["date"],
        props: { format: "YYYY-MM-DD" },
      }));

    it("parses property with number argument", () =>
      check("items | limit: 5", { path: ["items"], props: { limit: 5 } }));

    it("parses property with float number argument", () =>
      check("price | multiply: 1.5", {
        path: ["price"],
        props: { multiply: 1.5 },
      }));

    it("parses property with boolean true argument", () =>
      check("tasks | active: true", {
        path: ["tasks"],
        props: { active: true },
      }));

    it("parses property with boolean false argument", () =>
      check("tasks | active: false", {
        path: ["tasks"],
        props: { active: false },
      }));

    it("parses property with multiple arguments", () =>
      check('items | where: "done", true', {
        path: ["items"],
        props: { where: ["done", true] },
      }));

    it("parses chained propertys", () =>
      check('items | where: "done", true | limit: 5', {
        path: ["items"],
        props: { where: ["done", true], limit: 5 },
      }));

    it("parses property with whitespace around pipe", () =>
      check("  title  |  upper  ", {
        path: ["title"],
        props: { upper: true },
      }));

    it("parses complex chain with multiple propertys", () =>
      check('children | sort: "date" | template: "summary-card"', {
        path: ["children"],
        props: { sort: "date", template: "summary-card" },
      }));
  });

  describe("error handling", () => {
    it("returns error for empty expression", () =>
      checkError("", "empty-expression"));

    it("returns error for whitespace-only expression", () =>
      checkError("   ", "empty-expression"));

    it("returns error for empty path before pipe", () =>
      checkError("| upper", "empty-path"));

    it("returns error for empty property name", () =>
      checkError("title |", "empty-property-name"));

    it("returns error for empty property name in chain", () =>
      checkError("title | upper |", "empty-property-name"));

    it("returns error for path with empty segment", () =>
      checkError("parent..child", "invalid-path"));
  });
});
