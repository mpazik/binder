import { describe, it, expect } from "bun:test";
import { mockNodeSchema } from "@binder/db/mocks";
import type { KnowledgeGraph } from "@binder/db";
import { parseYamlDocument } from "../../document/yaml-cst.ts";
import { createYamlValidator } from "./yaml.ts";

describe("createYamlValidator", () => {
  const validator = createYamlValidator();

  const mockKg = {} as KnowledgeGraph;

  const mockDirectoryNavigationItem = {
    path: "test.yaml",
    query: { filters: { type: "Task" } },
  };

  const mockEntityNavigationItem = {
    path: "test.yaml",
    where: { type: "Task" },
    includes: { id: true, title: true, status: true },
  };

  const check = async (
    text: string,
    expectedErrors: Array<{ code: string; severity: string }>,
    navigationItem:
      | typeof mockEntityNavigationItem
      | typeof mockDirectoryNavigationItem = mockEntityNavigationItem,
  ) => {
    const content = parseYamlDocument(text);
    const errors = await validator.validate(content, {
      filePath: "test.yaml",
      navigationItem: navigationItem as any,
      schema: mockNodeSchema,
      ruleConfig: {},
      kg: mockKg,
    });

    expect(errors).toEqual(
      expectedErrors.map((err) => expect.objectContaining(err)),
    );
  };

  it("detects YAML syntax errors", async () => {
    await check(
      `
key: [unclosed
`,
      [{ code: "yaml-syntax-error", severity: "error" }],
    );
  });

  it("detects invalid field not in schema", async () => {
    await check(
      `
title: My Task
status: todo
unknownField: value
`,
      [{ code: "invalid-field", severity: "error" }],
    );
  });

  it("detects extra field not allowed for type", async () => {
    await check(
      `
type: Task
title: My Task
status: todo
name: Should be warning
`,
      [{ code: "extra-field", severity: "warning" }],
    );
  });

  it("validates invalid fields in directory items", async () => {
    await check(
      `
items:
  - title: Valid Task
    status: todo
  - title: Invalid Task
    unknownField: should error
`,
      [{ code: "invalid-field", severity: "error" }],
      mockDirectoryNavigationItem,
    );
  });

  it("validates extra fields in directory items", async () => {
    await check(
      `
items:
  - type: Task
    title: Valid Task
    status: todo
  - type: Task
    title: Another Task
    name: Should be warning
`,
      [{ code: "extra-field", severity: "warning" }],
      mockDirectoryNavigationItem,
    );
  });

  it("returns no errors for valid YAML", async () => {
    await check(
      `
type: Task
title: My Task
status: todo
`,
      [],
    );
  });

  it("detects invalid option value", async () => {
    await check(
      `
type: Task
title: My Task
status: invalid_status
`,
      [{ code: "invalid-value", severity: "error" }],
    );
  });

  it("detects invalid date format", async () => {
    await check(
      `
type: Task
title: My Task
status: todo
dueDate: not-a-date
`,
      [{ code: "invalid-value", severity: "error" }],
    );
  });

  it("returns no errors for valid date", async () => {
    await check(
      `
type: Task
title: My Task
status: todo
dueDate: 2024-01-15
`,
      [],
    );
  });

  it("returns no errors for valid option value", async () => {
    await check(
      `
type: Task
title: My Task
status: in_progress
`,
      [],
    );
  });

  it("detects invalid boolean value", async () => {
    await check(
      `
title: My Task
favorite: not-a-boolean
`,
      [{ code: "invalid-value", severity: "error" }],
    );
  });

  it("returns no errors for valid boolean", async () => {
    await check(
      `
title: My Task
favorite: true
`,
      [],
    );
  });

  it("validates array values even without allowMultiple in schema", async () => {
    await check(
      `
title: My Task
tags:
  - tag1
  - tag2
`,
      [],
    );
  });

  it("detects invalid values in array", async () => {
    await check(
      `
title: My Task
owners:
  - valid-ref
  - 123
`,
      [{ code: "invalid-value", severity: "error" }],
    );
  });
});
