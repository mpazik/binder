import { describe, it, expect } from "bun:test";
import { throwIfError } from "@binder/utils";
import "@binder/utils/tests";
import type {
  AncestralFieldValueProvider,
  Fieldset,
  FieldsetNested,
  NestedFieldValueProvider,
} from "@binder/db";
import {
  mockRecordSchema,
  mockProjectRecord,
  mockUserRecord,
} from "@binder/db/mocks";
import { resolvePath } from "../document/navigation.ts";
import { DOCUMENT_TEMPLATE_KEY } from "../document/template-entity.ts";
import {
  extractFieldNames,
  extractFieldValues,
  interpolateAncestralFields,
  interpolateFields,
  interpolateNestedFields,
  parseAncestralPlaceholder,
} from "./interpolate-fields.ts";

describe("interpolateFields", () => {
  const check = (template: string, fieldset: Fieldset, expected: string) => {
    const result = throwIfError(
      interpolateFields(mockRecordSchema, template, fieldset),
    );
    expect(result).toBe(expected);
  };

  const checkError = (
    template: string,
    fieldset: Fieldset,
    errorKey: string,
  ) => {
    const result = interpolateFields(mockRecordSchema, template, fieldset);
    expect(result).toBeErrWithKey(errorKey);
  };

  describe("basic interpolation", () => {
    it("replaces single field", () => {
      check("Hello {name}", { name: "World" }, "Hello World");
    });

    it("replaces multiple fields", () => {
      check("{title} {name}", { title: "Hi", name: "Bob" }, "Hi Bob");
    });

    it("handles missing fields as empty string", () => {
      check("Hello {name}", {}, "Hello ");
    });

    it("handles template without fields", () => {
      check("No fields here", { name: "World" }, "No fields here");
    });

    it("handles empty template", () => {
      check("", { name: "World" }, "");
    });
  });

  describe("value formatting", () => {
    it("formats string values", () => {
      check("{title}", { title: "text" }, "text");
    });

    it("formats number values", () => {
      check("{id}", { id: 42 }, "42");
    });

    it("formats boolean true", () => {
      check("{favorite}", { favorite: true }, "true");
    });

    it("formats boolean false", () => {
      check("{favorite}", { favorite: false }, "false");
    });

    it("formats null as empty string", () => {
      check("{title}", { title: null }, "");
    });

    it("formats array with comma-space separator", () => {
      check(
        "{tags}",
        { tags: ["urgent", "bug", "frontend"] },
        "urgent, bug, frontend",
      );
    });

    it("formats empty array as empty string", () => {
      check("{tags}", { tags: [] }, "");
    });
  });

  describe("escaping", () => {
    it("escapes opening brace", () => {
      check("\\{name}", { name: "World" }, "{name}");
    });

    it("escapes closing brace", () => {
      check("test\\}", { name: "World" }, "test}");
    });

    it("escapes both braces", () => {
      check("\\{name\\}", { name: "World" }, "{name}");
    });

    it("mixes escaped and non-escaped fields", () => {
      check("\\{literal} {name}", { name: "World" }, "{literal} World");
    });

    it("preserves backslash for non-brace characters", () => {
      check("test\\n{name}", { name: "World" }, "test\\nWorld");
    });
  });

  describe("invalid field names", () => {
    it("treats field with spaces as literal text", () => {
      check("{invalid field}", { "invalid field": "value" }, "{invalid field}");
    });

    it("treats field with special characters as literal text", () => {
      check("{field@name}", { "field@name": "value" }, "{field@name}");
    });
  });

  describe("error handling", () => {
    it("returns error for unclosed bracket", () => {
      checkError("{name", { name: "World" }, "unclosed-bracket");
    });

    it("returns error for field not in schema", () => {
      checkError("{unknown}", { unknown: "value" }, "field-not-found");
    });
  });

  describe("complex templates", () => {
    it("handles markdown-style template", () => {
      check(
        "# {title}\n\n**Type:** {type}\n**Key:** {key}\n",
        { title: "My Task", type: "Task", key: "task-1" },
        "# My Task\n\n**Type:** Task\n**Key:** task-1\n",
      );
    });

    it("handles path-style template", () => {
      check(
        "projects/{project}/tasks/{key}.md",
        { project: "binder", key: "task-123" },
        "projects/binder/tasks/task-123.md",
      );
    });
  });
});

describe("interpolateNestedFields", () => {
  const check = (
    template: string,
    fieldset: FieldsetNested,
    expected: string,
  ) => {
    const result = throwIfError(
      interpolateNestedFields(mockRecordSchema, template, fieldset),
    );
    expect(result).toBe(expected);
  };

  it("replaces flat field", () => {
    check("Hello {name}", { name: "World" }, "Hello World");
  });

  it("replaces nested field with dot notation", () => {
    check(
      "Project: {project.title}",
      { project: { title: "Binder" } },
      "Project: Binder",
    );
  });

  it("replaces deeply nested fields", () => {
    check(
      "{project.assignedTo.name}",
      { project: { assignedTo: { name: "Alice" } } },
      "Alice",
    );
  });

  it("handles missing nested field as empty string", () => {
    check("{project.title}", { project: {} }, "");
  });

  it("handles missing intermediate object as empty string", () => {
    check("{project.assignedTo.name}", { project: { title: "Binder" } }, "");
  });

  it("works with provider function", () => {
    const provider: NestedFieldValueProvider = (path) => {
      if (path.length === 1 && path[0] === "id") return 42;
      if (path.length === 2 && path[0] === "project" && path[1] === "name")
        return "Binder";
      return null;
    };
    const result = throwIfError(
      interpolateNestedFields(
        mockRecordSchema,
        "{id} - {project.name}",
        provider,
      ),
    );
    expect(result).toBe("42 - Binder");
  });
});

describe("extractFieldNames", () => {
  it("extracts single field name", () => {
    const result = extractFieldNames("Hello {name}");
    expect(result).toEqual(["name"]);
  });

  it("extracts multiple field names", () => {
    const result = extractFieldNames("{greeting} {name}");
    expect(result).toEqual(["greeting", "name"]);
  });

  it("extracts field names with underscores", () => {
    const result = extractFieldNames("{first_name} {last_name}");
    expect(result).toEqual(["first_name", "last_name"]);
  });

  it("extracts field names with hyphens", () => {
    const result = extractFieldNames("{first-name} {last-name}");
    expect(result).toEqual(["first-name", "last-name"]);
  });

  it("extracts field names with dots", () => {
    const result = extractFieldNames("{parent.child}");
    expect(result).toEqual(["parent.child"]);
  });

  it("ignores escaped braces", () => {
    const result = extractFieldNames("\\{literal} {name}");
    expect(result).toEqual(["name"]);
  });

  it("ignores invalid field names", () => {
    const result = extractFieldNames("{invalid field} {valid}");
    expect(result).toEqual(["valid"]);
  });

  it("returns empty array for template without fields", () => {
    const result = extractFieldNames("No fields here");
    expect(result).toEqual([]);
  });

  it("handles unclosed brackets gracefully", () => {
    const result = extractFieldNames("{name {other}");
    expect(result).toEqual([]);
  });

  it("extracts from complex template", () => {
    const result = extractFieldNames("# {title}\n\n**Type:** {type}\n");
    expect(result).toEqual(["title", "type"]);
  });
});

describe("extractFieldValues", () => {
  const check = (template: string, data: string, expected: Fieldset) => {
    const result = throwIfError(extractFieldValues(template, data));
    expect(result).toEqual(expected);
  };

  const checkError = (template: string, data: string, errorKey: string) => {
    const result = extractFieldValues(template, data);
    expect(result).toBeErrWithKey(errorKey);
  };

  it("success case - single variable", () => {
    check("tasks/{title}.md", "tasks/my-task.md", { title: "my-task" });
  });

  it("success case - two variables", () => {
    check(
      "projects/{project}/tasks/{key}.md",
      "projects/binder/tasks/feature-123.md",
      { project: "binder", key: "feature-123" },
    );
  });

  it("fail if doesn't match", () => {
    checkError(
      "tasks/{title}.md",
      "projects/binder/tasks/feature-123.md",
      "path_template_mismatch",
    );
  });

  it("handles empty value", () => {
    check("/{key}/something", "//something", { key: "" });
  });

  it("handles escaping like \\{key\\}/{key}", () => {
    check("\\{literal\\}/{key}", "{literal}/value", { key: "value" });
  });

  it("handles multiple escaped braces", () => {
    check("\\{prefix\\}_{key}_\\{suffix\\}", "{prefix}_my-key_{suffix}", {
      key: "my-key",
    });
  });

  it("handles unclosed bracket in template", () => {
    checkError("{name", "value", "unclosed-bracket");
  });

  it("handles extra data at end", () => {
    checkError(
      "tasks/{title}.md",
      "tasks/my-task.md/extra",
      "path_template_mismatch",
    );
  });

  it("handles missing data at end", () => {
    checkError("tasks/{title}.md", "tasks/my-task", "path_template_mismatch");
  });
});

describe("parseAncestralPlaceholder", () => {
  const check = (
    placeholder: string,
    expected: { fieldName: string; depth: number },
  ) => {
    expect(parseAncestralPlaceholder(placeholder)).toEqual(expected);
  };

  it("parses simple field as depth 0", () => {
    check("title", { fieldName: "title", depth: 0 });
  });

  it("parses parent.field as depth 1", () => {
    check("parent.key", { fieldName: "key", depth: 1 });
  });

  it("parses parent2.field as depth 2", () => {
    check("parent2.name", { fieldName: "name", depth: 2 });
  });

  it("parses parent10.field as depth 10", () => {
    check("parent10.id", { fieldName: "id", depth: 10 });
  });

  it("handles nested field names after parent prefix", () => {
    check("parent.nested.field", { fieldName: "nested.field", depth: 1 });
  });
});

describe("interpolateAncestralFields", () => {
  const check = (template: string, chain: Fieldset[], expected: string) => {
    const result = throwIfError(
      interpolateAncestralFields(mockRecordSchema, template, chain),
    );
    expect(result).toBe(expected);
  };

  it("interpolates depth 0 field from first fieldset", () => {
    check("{title}", [{ title: "Current" }, { title: "Parent" }], "Current");
  });

  it("interpolates parent.field from second fieldset", () => {
    check(
      "{parent.title}",
      [{ title: "Current" }, { title: "Parent" }],
      "Parent",
    );
  });

  it("interpolates parent2.field from third fieldset", () => {
    check(
      "{parent2.name}",
      [{ name: "Current" }, { name: "Parent" }, { name: "Grandparent" }],
      "Grandparent",
    );
  });

  it("interpolates mixed depth placeholders", () => {
    check(
      "{key} in {parent.key} by {parent2.key}",
      [{ key: "task-1" }, { key: "project-1" }, { key: "user-1" }],
      "task-1 in project-1 by user-1",
    );
  });

  it("returns empty string for missing field value", () => {
    check("{title}", [{}], "");
  });

  it("returns empty string for out-of-bounds depth", () => {
    check("{parent.title}", [{ title: "Current" }], "");
  });

  it("works with provider function", () => {
    const provider: AncestralFieldValueProvider = (fieldName, depth) => {
      if (depth === 0 && fieldName === "id") return 42;
      if (depth === 1 && fieldName === "name") return "Parent Name";
      return null;
    };
    const result = throwIfError(
      interpolateAncestralFields(
        mockRecordSchema,
        "{id} - {parent.name}",
        provider,
      ),
    );
    expect(result).toBe("42 - Parent Name");
  });

  it("works with mock records", () => {
    check(
      "{key} by {parent.name}",
      [mockProjectRecord, mockUserRecord],
      "project-binder-system by Rick",
    );
  });
});

it("round-trips with resolvePath", () => {
  const item: Fieldset = { project: "binder-cli", title: "My Task" };
  const navItem = {
    path: "projects/{project}/{title}",
    template: DOCUMENT_TEMPLATE_KEY,
  };
  const path = throwIfError(resolvePath(mockRecordSchema, navItem, item));
  expect(path).toBe("projects/binder-cli/My Task.md");
  const result = throwIfError(extractFieldValues(navItem.path + ".md", path));
  expect(result).toEqual({ project: "binder-cli", title: "My Task" });
});
