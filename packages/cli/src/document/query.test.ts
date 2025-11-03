import { describe, expect, test } from "bun:test";
import { extractFieldsetFromQuery, parseStringQuery } from "./query.ts";

const check = (query: string, expected: Record<string, string>) => {
  const queryParams = parseStringQuery(query);
  const result = extractFieldsetFromQuery(queryParams);
  expect(result).toEqual(expected);
};

describe("extractFieldsetFromQuery", () => {
  test("extracts single field", () => {
    check("type=Task", { type: "Task" });
  });

  test("extracts multiple fields", () => {
    check("type=Task, status=done", { type: "Task", status: "done" });
  });

  test("handles whitespace", () => {
    check("  type = Task  ,  status = done  ", {
      type: "Task",
      status: "done",
    });
  });

  test("ignores invalid pairs", () => {
    check("type=Task, invalid, status=done", { type: "Task", status: "done" });
  });

  test("returns empty object for empty string", () => {
    check("", {});
  });

  test("extracts fields separated by AND", () => {
    check("type=Task AND status=done", { type: "Task", status: "done" });
  });

  test("extracts multiple fields separated by AND", () => {
    check("type=Task AND project=pX9_kR2mQvL AND taskStatus=in-progress", {
      type: "Task",
      project: "pX9_kR2mQvL",
      taskStatus: "in-progress",
    });
  });

  test("handles mixed comma and AND separators", () => {
    check("type=Task, status=done AND priority=high", {
      type: "Task",
      status: "done",
      priority: "high",
    });
  });
});

describe("parseStringQuery", () => {
  test("parses query with AND separator", () => {
    const result = parseStringQuery(
      "type=Task AND project=pX9_kR2mQvL AND taskStatus=in-progress",
    );
    expect(result).toEqual({
      filters: {
        type: "Task",
        project: "pX9_kR2mQvL",
        taskStatus: "in-progress",
      },
    });
  });

  test("parses query with comma separator", () => {
    const result = parseStringQuery("type=Task, status=done");
    expect(result).toEqual({
      filters: {
        type: "Task",
        status: "done",
      },
    });
  });
});
