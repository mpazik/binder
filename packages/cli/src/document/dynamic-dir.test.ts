import { describe, expect, it } from "bun:test";
import "@binder/utils/tests";
import { throwIfError } from "@binder/utils";
import type { Fieldset } from "@binder/db";
import { extractFieldsFromPath, resolvePath } from "./dynamic-dir.ts";

describe("dynamic-dir", () => {
  describe("resolveFieldsetFromPath", () => {
    const check = (path: string, pathTemplate: string, expected: Fieldset) => {
      const result = throwIfError(extractFieldsFromPath(path, pathTemplate));
      expect(result).toEqual(expected);
    };

    it("extracts single field from path", () => {
      check("tasks/my-task.md", "tasks/{title}.md", { title: "my-task" });
    });

    it("extracts multiple fields from path", () => {
      check(
        "projects/binder/tasks/feature-123.md",
        "projects/{project}/tasks/{key}.md",
        {
          project: "binder",
          key: "feature-123",
        },
      );
    });

    it("extracts fields from path with directories", () => {
      check("docs/2024/january/report.md", "docs/{year}/{month}/{title}.md", {
        year: "2024",
        month: "january",
        title: "report",
      });
    });

    it("returns error when path does not match template", () => {
      const result = extractFieldsFromPath(
        "tasks/my-task.md",
        "projects/{project}/tasks/{key}.md",
      );
      expect(result).toBeErr();
    });

    it("round-trips with resolvePath", () => {
      const item: Fieldset = { project: "binder-cli", title: "My Task" };
      const template = "projects/{project}/{title}.md";
      const path = resolvePath(template, item);
      expect(path).toBe("projects/binder-cli/My Task.md");
      const result = throwIfError(extractFieldsFromPath(path, template));
      expect(result).toEqual({ project: "binder-cli", title: "My Task" });
    });
  });
});
