import { describe, it, expect } from "bun:test";
import { throwIfError } from "@binder/utils";
import "@binder/utils/tests";
import type { Fieldset } from "@binder/db";
import { resolvePath } from "../document/navigation.ts";
import {
  extractFieldNames,
  extractFieldValues,
  interpolateFields,
} from "./interpolate-fields.ts";

describe("interpolateFields", () => {
  const check = (template: string, fieldset: Fieldset, expected: string) => {
    const result = throwIfError(interpolateFields(template, fieldset));
    expect(result).toBe(expected);
  };

  const checkError = (
    template: string,
    fieldset: Fieldset,
    errorKey: string,
  ) => {
    const result = interpolateFields(template, fieldset);
    expect(result).toBeErrWithKey(errorKey);
  };

  describe("basic interpolation", () => {
    it("replaces single field", () => {
      check("Hello {name}", { name: "World" }, "Hello World");
    });

    it("replaces multiple fields", () => {
      check("{greeting} {name}", { greeting: "Hi", name: "Bob" }, "Hi Bob");
    });

    it("handles field names with underscores", () => {
      check("Value: {field_name}", { field_name: "test" }, "Value: test");
    });

    it("handles field names with hyphens", () => {
      check("Value: {field-name}", { "field-name": "test" }, "Value: test");
    });

    it("handles field names with dots", () => {
      check(
        "Value: {parent.child}",
        { "parent.child": "nested" },
        "Value: nested",
      );
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
      check("{value}", { value: "text" }, "text");
    });

    it("formats number values", () => {
      check("{id}", { id: 42 }, "42");
    });

    it("formats boolean true", () => {
      check("{active}", { active: true }, "true");
    });

    it("formats boolean false", () => {
      check("{active}", { active: false }, "false");
    });

    it("formats null as empty string", () => {
      check("{value}", { value: null }, "");
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

    it("formats array with numbers", () => {
      check("{ids}", { ids: [1, 2, 3] }, "1, 2, 3");
    });

    it("formats object as JSON", () => {
      check("{data}", { data: { key: "value" } }, '{"key":"value"}');
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

    it("returns error for unclosed bracket with multiple fields", () => {
      checkError(
        "{greeting} {name",
        { greeting: "Hi", name: "Bob" },
        "unclosed-bracket",
      );
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

it("round-trips with resolvePath", () => {
  const item: Fieldset = { project: "binder-cli", title: "My Task" };
  const template = "projects/{project}/{title}.md";
  const path = throwIfError(resolvePath(template, item));
  expect(path).toBe("projects/binder-cli/My Task.md");
  const result = throwIfError(extractFieldValues(template, path));
  expect(result).toEqual({ project: "binder-cli", title: "My Task" });
});
