import { describe, expect, it } from "bun:test";
import { mockRecordSchema } from "@binder/repo/mocks";
import type { KnowledgeGraph } from "@binder/repo";
import { parseYamlDocument } from "../../document/yaml-cst.ts";
import { createYamlValidator } from "./yaml.ts";

describe("createYamlValidator", () => {
  const validator = createYamlValidator();

  const mockKg = {} as KnowledgeGraph;

  const mockDirectoryNavigationItem = {
    path: "test",
    query: { filters: { type: "Task" } },
  };

  const mockEntityNavigationItem = {
    path: "test",
    where: { type: "Task" },
    includes: { id: true, title: true, status: true },
  };

  const check = async (
    text: string,
    expectedErrors: Array<{ code: string; severity: string }>,
    navigationItem:
      | typeof mockEntityNavigationItem
      | typeof mockDirectoryNavigationItem = mockEntityNavigationItem,
    schema = mockRecordSchema,
  ) => {
    const content = parseYamlDocument(text);
    const errors = await validator.validate(content, {
      filePath: "test.yaml",
      navigationItem,
      namespace: "record",
      schema,
      ruleConfig: {},
      kg: mockKg,
    });

    expect(errors).toEqual(
      expectedErrors.map((err) => expect.objectContaining(err)),
    );
  };

  const checkEntity = async (
    text: string,
    expectedErrors: Array<{ code: string; severity: string }>,
    schema = mockRecordSchema,
  ) => check(text, expectedErrors, mockEntityNavigationItem, schema);

  const checkDirectory = async (
    text: string,
    expectedErrors: Array<{ code: string; severity: string }>,
  ) => check(text, expectedErrors, mockDirectoryNavigationItem);

  it("detects YAML syntax errors", async () => {
    await checkEntity(
      `
key: [unclosed
`,
      [{ code: "yaml-syntax-error", severity: "error" }],
    );
  });

  it("detects invalid field not in schema", async () => {
    await checkEntity(
      `
title: My Task
status: pending
unknownField: value
`,
      [{ code: "invalid-field", severity: "error" }],
    );
  });

  it("detects extra field not allowed for type", async () => {
    await checkEntity(
      `
type: Task
title: My Task
status: pending
name: Should be warning
`,
      [{ code: "extra-field", severity: "warning" }],
    );
  });

  it("validates invalid fields in directory items", async () => {
    await checkDirectory(
      `
items:
  - title: Valid Task
    status: pending
  - title: Invalid Task
    unknownField: should error
`,
      [{ code: "invalid-field", severity: "error" }],
    );
  });

  it("validates extra fields in directory items", async () => {
    await checkDirectory(
      `
items:
  - type: Task
    title: Valid Task
    status: pending
  - type: Task
    title: Another Task
    name: Should be warning
`,
      [{ code: "extra-field", severity: "warning" }],
    );
  });

  it("returns no errors for valid YAML", async () => {
    await checkEntity(
      `
type: Task
title: My Task
status: pending
`,
      [],
    );
  });

  it("detects invalid option value", async () => {
    await checkEntity(
      `
type: Task
title: My Task
status: invalid_status
`,
      [{ code: "invalid-value", severity: "error" }],
    );
  });

  it("detects invalid date format", async () => {
    await checkEntity(
      `
type: Task
title: My Task
status: pending
dueDate: not-a-date
`,
      [{ code: "invalid-value", severity: "error" }],
    );
  });

  it("returns no errors for valid date", async () => {
    await checkEntity(
      `
type: Task
title: My Task
status: pending
dueDate: 2024-01-15
`,
      [],
    );
  });

  it("returns no errors for valid option value", async () => {
    await checkEntity(
      `
type: Task
title: My Task
status: active
`,
      [],
    );
  });

  it("applies type-level only option constraints", async () => {
    const schema = structuredClone(mockRecordSchema);
    schema.types.Task.fields = schema.types.Task.fields.map((ref) =>
      (Array.isArray(ref) ? ref[0] : ref) === "status"
        ? ["status", { only: ["pending", "active"] }]
        : ref,
    );

    await checkEntity(
      `
type: Task
title: My Task
status: complete
`,
      [{ code: "invalid-value", severity: "error" }],
      schema,
    );
  });

  it("detects invalid boolean value", async () => {
    await checkEntity(
      `
title: My Task
favorite: not-a-boolean
`,
      [
        { code: "extra-field", severity: "warning" },
        { code: "invalid-value", severity: "error" },
      ],
    );
  });

  it("returns no errors for valid boolean", async () => {
    await checkEntity(
      `
title: My Task
favorite: true
`,
      [{ code: "extra-field", severity: "warning" }],
    );
  });

  it("validates array values even without allowMultiple in schema", async () => {
    await checkEntity(
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
    await checkEntity(
      `
title: My Task
owners:
  - valid-ref
  - 123
`,
      [
        { code: "extra-field", severity: "warning" },
        { code: "invalid-value", severity: "error" },
      ],
    );
  });

  describe("nested relations", () => {
    const mockNestedNavigationItem = {
      path: "test",
      query: {
        filters: { type: "Task" },
        includes: {
          title: true,
          assignedTo: {
            name: true,
            email: true,
          },
        },
      },
    };

    it("validates nested relation fields", async () => {
      await check(
        `
items:
  - title: My Task
    assignedTo:
      name: John Doe
      email: john@example.com
`,
        [],
        mockNestedNavigationItem,
      );
    });

    it("detects invalid field in nested relation", async () => {
      await check(
        `
items:
  - title: My Task
    assignedTo:
      name: John Doe
      invalidField: should error
`,
        [{ code: "invalid-field", severity: "error" }],
        mockNestedNavigationItem,
      );
    });

    it("detects extra field not part of related type", async () => {
      await check(
        `
items:
  - title: My Task
    assignedTo:
      name: John Doe
      title: Should warn - not part of User type
`,
        [{ code: "extra-field", severity: "warning" }],
        mockNestedNavigationItem,
      );
    });

    it("detects invalid value type in nested relation", async () => {
      await check(
        `
items:
  - title: My Task
    assignedTo:
      name: John Doe
      email: 12345
`,
        [{ code: "invalid-value", severity: "error" }],
        mockNestedNavigationItem,
      );
    });

    it("validates deeply nested relations", async () => {
      const deepNestedNav = {
        path: "test",
        query: {
          filters: { type: "Project" },
          includes: {
            title: true,
            tasks: {
              title: true,
              assignedTo: {
                name: true,
              },
            },
          },
        },
      };
      await check(
        `
items:
  - title: My Project
    tasks:
      - title: Task 1
        assignedTo:
          name: John
      - title: Task 2
        assignedTo:
          invalidField: should error
`,
        [{ code: "invalid-field", severity: "error" }],
        deepNestedNav,
      );
    });
  });

  describe("directory shape validation", () => {
    it("allows only items field in directory", async () => {
      await checkDirectory(
        `
items:
  - type: Task
    title: My Task
`,
        [],
      );
    });

    it("detects unexpected field in directory", async () => {
      await checkDirectory(
        `
foo: bar
items:
  - type: Task
    title: My Task
`,
        [{ code: "unexpected-field", severity: "error" }],
      );
    });

    it("detects multiple unexpected fields in directory", async () => {
      await checkDirectory(
        `
foo: bar
baz: qux
items:
  - type: Task
    title: My Task
`,
        [
          { code: "unexpected-field", severity: "error" },
          { code: "unexpected-field", severity: "error" },
        ],
      );
    });

    it("detects items field that is not a sequence", async () => {
      await checkDirectory(
        `
items: not-a-sequence
`,
        [{ code: "invalid-structure", severity: "error" }],
      );
    });

    it("detects items field that is a map instead of sequence", async () => {
      await checkDirectory(
        `
items:
  key: value
`,
        [{ code: "invalid-structure", severity: "error" }],
      );
    });

    it("validates directory even with unexpected fields", async () => {
      await checkDirectory(
        `
foo: bar
items:
  - type: Task
    title: My Task
    unknownField: value
`,
        [
          { code: "unexpected-field", severity: "error" },
          { code: "invalid-field", severity: "error" },
        ],
      );
    });
  });
});
