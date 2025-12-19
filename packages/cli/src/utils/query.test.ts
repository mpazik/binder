import { describe, expect, test } from "bun:test";
import "@binder/utils/tests";
import { mockProjectNode, mockUserNode } from "@binder/db/mocks";
import { throwIfError } from "@binder/utils";
import type { AncestralFieldsetChain } from "@binder/db";
import { extractFieldsetFromQuery, parseStringQuery } from "./query.ts";

const check = (
  text: string,
  parents: AncestralFieldsetChain | undefined,
  expected: Record<string, string>,
) => {
  const result = parseStringQuery(text, parents);
  expect(result).toBeOkWith({ filters: expected });
};

const checkError = (
  text: string,
  parents: AncestralFieldsetChain | undefined,
  errorKey: string,
) => {
  const result = parseStringQuery(text, parents);
  expect(result).toBeErrWithKey(errorKey);
};

const checkLegacy = (query: string, expected: Record<string, string>) => {
  const queryParams = throwIfError(parseStringQuery(query));
  const result = extractFieldsetFromQuery(queryParams);
  expect(result).toEqual(expected);
};

describe("extractFieldsetFromQuery", () => {
  test("extracts single field", () => {
    checkLegacy("type=Task", { type: "Task" });
  });

  test("extracts multiple fields", () => {
    checkLegacy("type=Task, status=done", { type: "Task", status: "done" });
  });

  test("handles whitespace", () => {
    checkLegacy("  type = Task  ,  status = done  ", {
      type: "Task",
      status: "done",
    });
  });

  test("ignores invalid pairs", () => {
    checkLegacy("type=Task, invalid, status=done", {
      type: "Task",
      status: "done",
    });
  });

  test("returns empty object for empty string", () => {
    checkLegacy("", {});
  });

  test("extracts fields separated by AND", () => {
    checkLegacy("type=Task AND status=done", { type: "Task", status: "done" });
  });

  test("extracts multiple fields separated by AND", () => {
    checkLegacy(
      "type=Task AND project=pX9_kR2mQvL AND taskStatus=in-progress",
      {
        type: "Task",
        project: "pX9_kR2mQvL",
        taskStatus: "in-progress",
      },
    );
  });

  test("handles mixed comma and AND separators", () => {
    checkLegacy("type=Task, status=done AND priority=high", {
      type: "Task",
      status: "done",
      priority: "high",
    });
  });
});

describe("parseStringQuery", () => {
  test("parses query with AND separator", () => {
    check(
      "type=Task AND project=pX9_kR2mQvL AND taskStatus=in-progress",
      undefined,
      {
        type: "Task",
        project: "pX9_kR2mQvL",
        taskStatus: "in-progress",
      },
    );
  });

  test("parses query with comma separator", () => {
    check("type=Task, status=done", undefined, {
      type: "Task",
      status: "done",
    });
  });

  test("resolves {parent.key} with parent context", () => {
    check("type=Task AND project={parent.key}", [mockProjectNode], {
      type: "Task",
      project: "project-binder-system",
    });
  });

  test("resolves multiple placeholders in single query", () => {
    check(
      "type=Task AND project={parent.key} AND projectTitle={parent.title}",
      [mockProjectNode],
      {
        type: "Task",
        project: "project-binder-system",
        projectTitle: "Binder System",
      },
    );
  });

  test("resolves {parent2.key} with grandparent context", () => {
    check(
      "type=Milestone AND owner={parent2.name}",
      [mockProjectNode, mockUserNode],
      {
        type: "Milestone",
        owner: "Rick",
      },
    );
  });

  test("omits filter when parent field is missing", () => {
    check("type=Task AND milestone={parent.nonexistent}", [mockProjectNode], {
      type: "Task",
    });
  });

  test("returns error when unrecognized placeholder syntax", () => {
    checkError(
      "type=Task AND project={parent9.key}",
      [mockProjectNode],
      "context-not-found",
    );
  });
});
