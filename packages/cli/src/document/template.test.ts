import { describe, expect, it } from "bun:test";
import "@binder/utils/tests";
import { throwIfError } from "@binder/utils";
import type { Fieldset } from "@binder/db";
import {
  compileTemplate,
  extractFieldsFromRendered,
  extractFieldsFromRenderedItems,
} from "./template.ts";

describe("template", () => {
  describe("extractFieldsFromRendered", () => {
    const check = (template: string, rendered: string, expected: Fieldset) => {
      const data = throwIfError(extractFieldsFromRendered(template, rendered));
      expect(data).toEqual(expected);
    };

    it("extracts variables from simple template", () => {
      check(
        "# {{title}}\n\n{{description}}",
        "# My Task\n\nThis is a description",
        {
          title: "My Task",
          description: "This is a description",
        },
      );
    });

    it("extracts nested path variables", () => {
      check(
        "# {{person.name}}\n\n{{person.email}}",
        "# John Doe\n\njohn@example.com",
        {
          person: {
            name: "John Doe",
            email: "john@example.com",
          },
        },
      );
    });

    it("handles conditional with true condition", () => {
      check(
        "# {{title}}\n{{#if key}}**Key:** {{key}}{{/if}}",
        "# My Task\n**Key:** task-123",
        {
          title: "My Task",
          key: "task-123",
        },
      );
    });

    it("handles conditional with false condition", () => {
      check("# {{title}}\n{{#if key}}**Key:** {{key}}{{/if}}", "# My Task\n", {
        title: "My Task",
      });
    });

    it("handles multiple conditionals", () => {
      check(
        "# {{title}}\n\n{{#if description}}{{description}}{{/if}}\n\n{{#if status}}**Status:** {{status}}{{/if}}",
        "# My Task\nThis is a description\n**Status:** Active",
        {
          title: "My Task",
          description: "This is a description",
          status: "Active",
        },
      );
    });

    it("handles nested paths with conditionals", () => {
      check(
        "# {{user.name}}\n{{#if user.email}}**Email:** {{user.email}}{{/if}}",
        "# Jane Smith\n**Email:** jane@example.com",
        {
          user: {
            name: "Jane Smith",
            email: "jane@example.com",
          },
        },
      );
    });

    it("returns error when template and markdown structure mismatch", () => {
      const templateString = "# {{title}}\n\n**Type:** {{type}}";
      const rendered = "# My Task\n\nSome random text";

      const result = extractFieldsFromRendered(templateString, rendered);

      expect(result).toBeErr();
    });

    it("extracts inline field values without capturing newlines", () => {
      check(
        "# Task: {{title}}\n**UID:** {{uid}}\n**Status:** {{status}}\n**Priority:** {{priority}}\n\n## Description\n\n{{description}}",
        "# Task: Implement schema generator\n**UID:** task-def456\n**Status:** closed\n**Priority:** high\n\n## Description\n\nCreate a dynamic schema generator",
        {
          title: "Implement schema generator",
          uid: "task-def456",
          status: "closed",
          priority: "high",
          description: "Create a dynamic schema generator",
        },
      );
    });

    it("extracts inline field values with conditional", () => {
      const template = `# {{type}}: {{title}}
**UID:** {{uid}}
**Status:** {{status}}
**Priority:** {{priority}}
{{#if description}}

## Description

{{description}}
{{/if}}`;

      const rendered =
        "# Task: Implement schema generator\n**UID:** task-def456\n**Status:** closed\n**Priority:** high\n\n## Description\n\nCreate a dynamic schema generator\n";

      check(template, rendered, {
        type: "Task",
        title: "Implement schema generator",
        uid: "task-def456",
        status: "closed",
        priority: "high",
        description: "Create a dynamic schema generator",
      });
    });

    it("extracts inline field values with conditional - exact template structure", () => {
      const template =
        "**Priority:** {{priority}}\n{{#if description}}\n\n## Description\n\n{{description}}\n{{/if}}";

      const compiledTemplate = throwIfError(compileTemplate(template));
      const rendered = compiledTemplate({
        priority: "high",
        description: "Create a dynamic schema generator",
      });

      check(template, rendered, {
        priority: "high",
        description: "Create a dynamic schema generator",
      });
    });

    it("extracts inline field followed by newline and content", () => {
      check(
        "**Priority:** {{priority}}\n\n## Description\n\n{{description}}",
        "**Priority:** high\n\n## Description\n\nCreate a dynamic schema generator",
        {
          priority: "high",
          description: "Create a dynamic schema generator",
        },
      );
    });

    it("handles empty inline field values", () => {
      check(
        "**Status:** {{status}}\n**Priority:** {{priority}}",
        "**Status:** \n**Priority:** High",
        {
          status: null,
          priority: "High",
        },
      );
    });

    it("handles empty inline field values - full template", () => {
      check(
        "# {{type}}: {{title}}\n**UID:** {{uid}}\n**Status:** {{status}}\n**Priority:** {{priority}}\n\n## Description\n{{description}}",
        "# Task: Implement schema generator\n**UID:** task-def456\n**Status:** \n**Priority:** High\n\n## Description\nCreate a dynamic schema generator",
        {
          type: "Task",
          title: "Implement schema generator",
          uid: "task-def456",
          status: null,
          priority: "High",
          description: "Create a dynamic schema generator",
        },
      );
    });
  });

  describe("extractFieldsFromRenderedItems", () => {
    const check = (
      template: string,
      rendered: string,
      expected: Fieldset[],
    ) => {
      const data = throwIfError(
        extractFieldsFromRenderedItems(template, rendered),
      );
      expect(data).toEqual(expected);
    };

    it("returns empty array for empty content", () => {
      check("title: {{title}}\n  description: {{description}}", "", []);
    });

    const task1 = {
      title: "Task 1",
      description: "First task",
    };
    const task2 = {
      title: "Task 2",
      description: "Second task",
    };

    it("extracts single item", () => {
      check(
        "title: {{title}}\n  description: {{description}}",
        "- title: Task 1\n  description: First task",
        [task1],
      );
    });

    it("extracts multiple items with simple template", () => {
      check(
        "title: {{title}}\n  description: {{description}}",
        "- title: Task 1\n  description: First task\n- title: Task 2\n  description: Second task",
        [task1, task2],
      );
    });

    it("extracts multiple items with three items", () => {
      check(
        "title: {{title}}\n  description: {{description}}",
        "- title: Task 1\n  description: First task\n- title: Task 2\n  description: Second task\n- title: Task 3\n  description: Third task",
        [
          task1,
          task2,
          {
            title: "Task 3",
            description: "Third task",
          },
        ],
      );
    });

    it("extracts multiple items with conditionals present", () => {
      check(
        "title: {{title}}\n  {{#if status}}status: {{status}}\n  {{/if}}description: {{description}}",
        "- title: Task 1\n  status: active\n  description: First task\n- title: Task 2\n  description: Second task",
        [
          {
            title: "Task 1",
            status: "active",
            description: "First task",
          },
          task2,
        ],
      );
    });

    it("extracts multiple items with different line counts due to conditionals", () => {
      check(
        "## {{title}}{{#if status}}\nStatus: {{status}}{{/if}}",
        "- ## Task 1\nStatus: active- ## Task 2- ## Task 3\nStatus: completed",
        [
          {
            title: "Task 1",
            status: "active",
          },
          {
            title: "Task 2",
          },
          {
            title: "Task 3",
            status: "completed",
          },
        ],
      );
    });

    it("handles items with extra whitespace between them", () => {
      check(
        "title: {{title}}\n  description: {{description}}",
        "- title: Task 1\n  description: First task\n\n- title: Task 2\n  description: Second task",
        [task1, task2],
      );
    });

    it("extracts items when template has no start anchor by splitting on list markers", () => {
      check("{{title}}", "- Task 1\n- Task 2", [
        { title: "Task 1" },
        { title: "Task 2" },
      ]);
    });

    it("returns error when item does not match template", () => {
      const result = extractFieldsFromRenderedItems(
        "title: {{title}}\n  description: {{description}}",
        "- title: Task 1\n  invalid_field: First task\n- title: Task 2\n  description: Second task",
      );

      expect(result).toBeErr();
    });
  });
});
