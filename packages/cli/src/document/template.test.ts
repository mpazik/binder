import { describe, expect, it } from "bun:test";
import "@binder/utils/tests";
import { pick, throwIfError } from "@binder/utils";
import type { FieldsetNested } from "@binder/db";
import {
  mockNodeSchema,
  mockProjectNode,
  mockTask1Node,
  mockTask2Node,
  mockTask3Node,
} from "@binder/db/mocks";
import {
  extractFieldMappings,
  extractFieldPathsFromAst,
  extractFieldsAst,
  extractFieldSlotsFromAst,
  type FieldSlotMapping,
  parseTemplate,
  renderTemplateAst,
} from "./template.ts";
import { parseAst, parseMarkdown } from "./markdown.ts";
import { createTemplateEntity, type Templates } from "./template-entity.ts";
import { mockDefaultTemplates, mockTaskTemplate } from "./template.mock.ts";

describe("template", () => {
  describe("renderTemplateAst", () => {
    const check = (
      view: string,
      data: FieldsetNested,
      expected: string,
      templates: Templates = mockDefaultTemplates,
    ) => {
      const ast = parseTemplate(view);
      const result = throwIfError(
        renderTemplateAst(mockNodeSchema, templates, ast, data),
      );
      expect(result).toBe(expected);
    };

    const checkError = (
      view: string,
      data: FieldsetNested,
      expectedKey: string,
      templates: Templates = mockDefaultTemplates,
    ) => {
      const ast = parseTemplate(view);
      const result = renderTemplateAst(mockNodeSchema, templates, ast, data);
      expect(result).toBeErrWithKey(expectedKey);
    };

    describe("scalar fields", () => {
      it("single field in heading", () => {
        check("# {title}\n", mockTask1Node, `# ${mockTask1Node.title}\n`);
      });

      it("multiple fields", () => {
        check(
          "# {title}\n\n**Status:** {status}\n",
          mockTask1Node,
          `# ${mockTask1Node.title}\n\n**Status:** ${mockTask1Node.status}\n`,
        );
      });

      it("multiple slots in same paragraph", () => {
        check(
          "{title} ({status})\n",
          mockTask1Node,
          `${mockTask1Node.title} (${mockTask1Node.status})\n`,
        );
      });

      it("adjacent slots without separator", () => {
        check(
          "{title}{status}\n",
          mockTask1Node,
          `${mockTask1Node.title}${mockTask1Node.status}\n`,
        );
      });

      it("escaped braces", () => {
        check(
          "\\{title\\} {title}\n",
          mockTask1Node,
          `{title} ${mockTask1Node.title}\n`,
        );
      });

      it("strong formatting around slot", () => {
        check(
          "**{title}**\n",
          pick(mockTask1Node, ["title"]),
          `**${mockTask1Node.title}**\n`,
        );
      });

      it("nested field value", () => {
        check(
          "**Project:** {project.title}\n",
          { project: mockProjectNode },
          `**Project:** ${mockProjectNode.title}\n`,
        );
      });
    });

    describe("scalar field types", () => {
      it("number as string", () => {
        check("**ID:** {id}\n", mockTask1Node, "**ID:** 1\n");
      });

      it("boolean true/false", () => {
        check(
          "**Favorite:** {favorite}\n",
          { favorite: true },
          "**Favorite:** true\n",
        );
        check(
          "**Favorite:** {favorite}\n",
          { favorite: false },
          "**Favorite:** false\n",
        );
      });

      it("date as ISO string", () => {
        check(
          "**Due:** {dueDate}\n",
          { dueDate: "2024-12-25" },
          "**Due:** 2024-12-25\n",
        );
      });

      it("decimal as string", () => {
        check("**Price:** {price}\n", { price: 19.99 }, "**Price:** 19.99\n");
      });

      it("empty string as empty", () => {
        check("**Title:** {title}\n", { title: "" }, "**Title:** \n");
      });

      it("null as empty string", () => {
        check("**Email:** {email}\n", { email: null }, "**Email:** \n");
      });

      it("undefined as empty string", () => {
        check("**Email:** {email}\n", {}, "**Email:** \n");
      });

      it("null number as empty string", () => {
        check("**ID:** {id}\n", { id: null }, "**ID:** \n");
      });

      it("null date as empty string", () => {
        check("**Due:** {dueDate}\n", { dueDate: null }, "**Due:** \n");
      });
    });

    describe("field escaping", () => {
      it("escapes plaintext value that contains formatting", () => {
        check(
          "{title}\n",
          { title: "**Bold Title**" },
          "\\*\\*Bold Title\\*\\*\n",
        );
      });

      it("preserves richtext value formatting", () => {
        check(
          "{description}\n",
          { description: "**Bold Description**" },
          "**Bold Description**\n",
        );
      });
    });

    describe("richtext fields", () => {
      it("multi-line value", () => {
        check(
          "{description}\n",
          { description: "Line one\nLine two" },
          "Line one\nLine two\n",
        );
      });

      it("block-level with headers", () => {
        check(
          "{templates}\n",
          { templates: "# Heading\n\nParagraph text" },
          "# Heading\n\nParagraph text\n",
        );
      });

      it("block-level with lists", () => {
        check(
          "{chapters}\n",
          { chapters: "- Item one\n- Item two" },
          "- Item one\n- Item two\n",
        );
      });
    });

    describe("blockquote", () => {
      it("plaintext field", () => {
        check("> {title}\n", mockTask1Node, `> ${mockTask1Node.title}\n`);
      });

      it("empty plaintext field", () => {
        check("> {email}\n", { email: null }, ">\n");
      });

      it("richtext field", () => {
        check(
          "> {description}\n",
          { description: "Some text\nNewLine" },
          "> Some text\n> NewLine\n",
        );
      });

      it("empty richtext field", () => {
        check("> {description}\n", { description: null }, ">\n");
      });
    });

    describe("array fields", () => {
      it("comma-separated values in inline position", () => {
        check(
          "**Tags:** {tags}\n",
          { tags: ["urgent", "important"] },
          "**Tags:** urgent, important\n",
        );
      });

      it("empty array as empty string", () => {
        check("**Tags:** {tags}\n", { tags: [] }, "**Tags:** \n");
      });

      it("single element array", () => {
        check("**Tags:** {tags}\n", { tags: ["urgent"] }, "**Tags:** urgent\n");
      });
    });

    describe("multi-value formats", () => {
      it("plaintext line format with newlines", () => {
        check(
          "{aliases}\n",
          { aliases: ["John", "Johnny", "J"] },
          "John\nJohnny\nJ\n",
        );
      });

      it("plaintext line format single element", () => {
        check("{aliases}\n", { aliases: ["John"] }, "John\n");
      });

      it("plaintext line format empty", () => {
        check("{aliases}\n", { aliases: [] }, "");
      });

      it("plaintext paragraph format with blank lines", () => {
        check(
          "{notes}\n",
          { notes: ["First note.", "Second note."] },
          "First note.\n\nSecond note.\n",
        );
      });

      it("richtext block format with blank lines", () => {
        check(
          "{steps}\n",
          { steps: ["Step **one**", "Step **two**"] },
          "Step **one**\n\nStep **two**\n",
        );
      });

      it("richtext document format with headers", () => {
        check(
          "{chapters}\n",
          { chapters: ["# Ch 1\n\nContent 1", "# Ch 2\n\nContent 2"] },
          "# Ch 1\n\nContent 1\n\n---\n\n# Ch 2\n\nContent 2\n",
        );
      });

      it("richtext document format with hrules", () => {
        check(
          "{templates}\n",
          { templates: ["Doc **A**", "Doc **B**"] },
          "Doc **A**\n\n---\n\nDoc **B**\n",
        );
      });
    });

    describe("nested fields", () => {
      it("multi-value nested plaintext in phrase position", () => {
        check(
          "{tasks.title}, and more\n",
          { tasks: [mockTask2Node, mockTask3Node] },
          `${mockTask2Node.title}, ${mockTask3Node.title}, and more\n`,
        );
      });

      it("multi-value nested plaintext in line position", () => {
        check(
          "**Tasks:** {tasks.title}\n",
          { tasks: [mockTask2Node, mockTask3Node] },
          `**Tasks:** ${mockTask2Node.title}\n${mockTask3Node.title}\n`,
        );
      });

      it("multi-value nested plaintext in block position", () => {
        check(
          "{tasks.title}\n\nMore content.\n",
          { tasks: [mockTask2Node, mockTask3Node] },
          `${mockTask2Node.title}\n\n${mockTask3Node.title}\n\nMore content.\n`,
        );
      });

      it("multi-value nested richtext in line position", () => {
        check(
          "**Descriptions:** {tasks.description}\n",
          { tasks: [mockTask2Node, mockTask3Node] },
          `**Descriptions:** ${mockTask2Node.description}\n${mockTask3Node.description}\n`,
        );
      });

      it("multi-value nested richtext in block position", () => {
        check(
          "{tasks.description}\n\nMore content.\n",
          { tasks: [mockTask2Node, mockTask3Node] },
          `${mockTask2Node.description}\n\n${mockTask3Node.description}\n\nMore content.\n`,
        );
      });

      it("empty multi-value nested field as empty string", () => {
        check("**Tasks:** {tasks.title}\n", { tasks: [] }, "**Tasks:** \n");
      });

      it("single relation with nested multi-value in inline position", () => {
        check(
          "**Tags:** {project.tags}\n",
          { project: { ...mockProjectNode, tags: ["urgent", "backend"] } },
          "**Tags:** urgent, backend\n",
        );
      });

      it("single relation with nested multi-value in block position", () => {
        check(
          "{project.tags}\n\nMore content.\n",
          { project: { ...mockProjectNode, tags: ["urgent", "backend"] } },
          "urgent, backend\n\nMore content.\n",
        );
      });
    });

    describe("single relation", () => {
      it("inline position", () => {
        check(
          "**Project:** {project}\n",
          { project: mockProjectNode },
          `**Project:** ${mockProjectNode.title}\n`,
        );
      });

      it("block position", () => {
        check(
          "{project}\n\nMore content below.\n",
          { project: mockProjectNode },
          `**${mockProjectNode.title}**\n\n${mockProjectNode.description}\n\nMore content below.\n`,
        );
      });

      it("section position", () => {
        check(
          "## Project\n\n{project}\n\n## Next\n",
          { project: mockProjectNode },
          `## Project\n\n### ${mockProjectNode.title}\n\n${mockProjectNode.description}\n\n## Next\n`,
        );
      });

      it("document position", () => {
        check(
          "{project}\n",
          { project: mockProjectNode },
          `# ${mockProjectNode.title}\n\n**Type:** ${mockProjectNode.type}\n**Key:** ${mockProjectNode.key}\n\n## Description\n\n${mockProjectNode.description}\n`,
        );
      });

      it("custom template", () => {
        const template = createTemplateEntity(
          "project-item",
          "**{title}** ({status})",
          { templateFormat: "phrase" },
        );
        check(
          "**Project:** {project|template:project-item}\n",
          { project: mockProjectNode },
          `**Project:** **${mockProjectNode.title}** (${mockProjectNode.status})\n`,
          [template],
        );
      });

      it("null value as empty string", () => {
        check("**Project:** {project}\n", { project: null }, "**Project:** \n");
      });
    });

    describe("multi-value relation", () => {
      it("default template", () => {
        check(
          "## Tasks\n\n{tasks}\n",
          {
            tasks: [mockTask2Node, mockTask3Node],
          },
          `## Tasks\n\n### ${mockTask2Node.title}\n\n${mockTask2Node.description}\n\n### ${mockTask3Node.title}\n\n${mockTask3Node.description}\n`,
        );
      });

      it("template key lookup for status", () => {
        const template = createTemplateEntity(
          "task-status",
          "- {title}: {status}",
          {
            templateFormat: "line",
          },
        );
        check(
          "## Tasks\n\n{tasks|template:task-status}\n",
          { tasks: [mockTask2Node, mockTask3Node] },
          `## Tasks\n\n- ${mockTask2Node.title}: ${mockTask2Node.status}\n- ${mockTask3Node.title}: ${mockTask3Node.status}\n`,
          [template],
        );
      });

      it("template key lookup", () => {
        const template = createTemplateEntity("task-item", "- **{title}**", {
          templateFormat: "line",
        });

        check(
          "{tasks|template:task-item}\n",
          { tasks: [mockTask2Node, mockTask3Node] },
          `- **${mockTask2Node.title}**\n- **${mockTask3Node.title}**\n`,
          [template],
        );
      });

      it("empty as empty string", () => {
        check("## Tasks\n\n{tasks}\n", { tasks: [] }, "## Tasks\n\n");
      });

      it("inline position", () => {
        check(
          "**Tasks:** {tasks}\n",
          { tasks: [mockTask2Node, mockTask3Node] },
          `**Tasks:** ${mockTask2Node.title}, ${mockTask3Node.title}\n`,
        );
      });

      it("block position", () => {
        check(
          "{tasks}\n\nMore content below.\n",
          { tasks: [mockTask2Node, mockTask3Node] },
          `**${mockTask2Node.title}**\n\n${mockTask2Node.description}\n\n**${mockTask3Node.title}**\n\n${mockTask3Node.description}\n\nMore content below.\n`,
        );
      });

      it("section position", () => {
        check(
          "## Tasks\n\n{tasks}\n\n## Next\n",
          { tasks: [mockTask2Node, mockTask3Node] },
          `## Tasks\n\n### ${mockTask2Node.title}\n\n${mockTask2Node.description}\n\n### ${mockTask3Node.title}\n\n${mockTask3Node.description}\n\n## Next\n`,
        );
      });

      it("document position", () => {
        check(
          "{tasks}\n",
          { tasks: [mockTask2Node, mockTask3Node] },
          `# ${mockTask2Node.title}\n\n**Type:** ${mockTask2Node.type}\n**Key:** ${mockTask2Node.key}\n\n## Description\n\n${mockTask2Node.description}\n\n---\n\n# ${mockTask3Node.title}\n\n**Type:** ${mockTask3Node.type}\n**Key:** ${mockTask3Node.key}\n\n## Description\n\n${mockTask3Node.description}\n`,
        );
      });
    });

    describe("errors", () => {
      it("non-existent field in schema", () => {
        checkError("**Missing:** {nonExistentField}\n", {}, "field-not-found");
      });

      it("non-existent nested field in schema", () => {
        checkError(
          "**Project:** {project.nonExistentField}\n",
          { project: mockProjectNode },
          "field-not-found",
        );
      });

      it("multi-relation with nested multi-value field", () => {
        checkError(
          "{tasks.steps}\n",
          { tasks: [{ steps: ["Step 1", "Step 2"] }] },
          "nested-multi-value-not-supported",
        );
      });

      it("path with more than 2 levels", () => {
        checkError(
          "{project.tasks.title}\n",
          { project: { tasks: [{ title: "Task 1" }] } },
          "nested-path-too-deep",
        );
      });

      it("section-format richtext in inline position", () => {
        checkError(
          "**Chapters:** {chapters}\n",
          { chapters: ["# Ch 1\n\nContent"] },
          "format-position-incompatible",
        );
      });

      it("document-format richtext in inline position", () => {
        checkError(
          "**Templates:** {templates}\n",
          { templates: ["Doc content"] },
          "format-position-incompatible",
        );
      });

      it("block-format richtext in inline position", () => {
        checkError(
          "**Steps:** {steps}\n",
          { steps: ["Step **one**"] },
          "format-position-incompatible",
        );
      });

      it("section template in inline slot position", () => {
        const template = createTemplateEntity(
          "section-tpl",
          "### {title}\n\n{description}",
          { templateFormat: "section" },
        );
        checkError(
          "**Project:** {project|template:section-tpl}\n",
          { project: mockProjectNode },
          "format-position-incompatible",
          [template],
        );
      });

      it("document template in block slot position", () => {
        const template = createTemplateEntity(
          "doc-tpl",
          "# {title}\n\n{description}",
          { templateFormat: "document" },
        );
        checkError(
          "{project|template:doc-tpl}\n\nMore content.\n",
          { project: mockProjectNode },
          "format-position-incompatible",
          [template],
        );
      });

      it("circular template reference", () => {
        const selfRefTemplate = createTemplateEntity(
          "self-ref",
          "{title}\n\n{project|template:self-ref}",
          { templateFormat: "block" },
        );
        checkError(
          "{project|template:self-ref}\n",
          {
            project: {
              title: "Outer Project",
              project: {
                title: "Inner Project",
              },
            },
          },
          "template-cycle-detected",
          [selfRefTemplate],
        );
      });
    });
  });

  describe("extractFieldsAst", () => {
    const check = (
      view: string,
      output: string,
      expected: FieldsetNested,
      templates: Templates = mockDefaultTemplates,
    ) => {
      const viewAst = parseTemplate(view);
      const snapAst = parseMarkdown(output);
      const result = throwIfError(
        extractFieldsAst(mockNodeSchema, templates, viewAst, snapAst),
      );
      expect(result).toEqual(expected);
    };

    const checkErr = (view: string, output: string, expectedKey: string) => {
      const ast = parseTemplate(view);
      const snapAst = parseMarkdown(output);
      const result = extractFieldsAst(
        mockNodeSchema,
        mockDefaultTemplates,
        ast,
        snapAst,
      );
      expect(result).toBeErrWithKey(expectedKey);
    };

    describe("scalar fields", () => {
      it("single field", () => {
        check(
          "# {title}\n",
          `# ${mockTask1Node.title}\n`,
          pick(mockTask1Node, ["title"]),
        );
      });

      it("multiple fields", () => {
        check(
          "# {title}\n\n**Status:** {status}\n",
          `# ${mockTask1Node.title}\n\n**Status:** ${mockTask1Node.status}\n`,
          pick(mockTask1Node, ["title", "status"]),
        );
      });

      it("multiple slots in same paragraph", () => {
        check("{title} ({status})\n", "My Task (pending)\n", {
          title: "My Task",
          status: "pending",
        });
      });

      it("escaped braces in view", () => {
        check(
          "\\{title\\} {title}\n",
          `{title} ${mockTask1Node.title}\n`,
          pick(mockTask1Node, ["title"]),
        );
      });

      it("field with formatting around slot", () => {
        check("**{title}**\n", "**Task 1**\n", { title: "Task 1" });
      });

      it("two fields with formatting around first", () => {
        check("**{title}**: {description}\n", "**Task 1**: Description 1\n", {
          title: "Task 1",
          description: "Description 1",
        });
      });

      it("trims whitespace from values", () => {
        check(
          "# {title}\n",
          `#   ${mockTask1Node.title}  \n`,
          pick(mockTask1Node, ["title"]),
        );
      });

      it("nested field value", () => {
        check(
          "**Project:** {project.title}\n",
          `**Project:** ${mockProjectNode.title}\n`,
          { project: pick(mockProjectNode, ["title"]) },
        );
      });
    });

    describe("scalar field types", () => {
      it("number as string if string data type", () => {
        check("**Title:** {title}\n", `**Title:** 1\n`, { title: "1" });
      });

      it("number as number if number data type", () => {
        check("**Id:** {id}\n", `**Id:** 1\n`, { id: 1 });
      });

      it("boolean as string if string data type", () => {
        check("**Title:** {title}\n", `**Title:** true\n`, { title: "true" });
      });

      it("boolean as boolean if boolean data type", () => {
        check("**Favorite:** {favorite}\n", `**Favorite:** true\n`, {
          favorite: true,
        });
      });

      it("date as string", () => {
        check("**Due:** {dueDate}\n", "**Due:** 2024-12-25\n", {
          dueDate: "2024-12-25",
        });
      });

      it("decimal as number", () => {
        check("**Price:** {price}\n", "**Price:** 19.99\n", { price: 19.99 });
      });

      it("empty and whitespace-only as null", () => {
        check("**Email:** {email}\n", "**Email:** \n", { email: null });
      });

      it("empty string value as null", () => {
        check("**Description:** {description}\n", "**Description:** \n", {
          description: null,
        });
      });

      it("empty number as null", () => {
        check("ID: {id}\n", `ID: \n`, { id: null });
      });
    });

    describe("richtext fields", () => {
      it("multi-line value", () => {
        check("{description}\n", "Line one\nLine two\n", {
          description: "Line one\nLine two",
        });
      });
    });

    describe("array fields", () => {
      it("comma-separated values", () => {
        check("Tags: {tags}\n", `Tags: urgent, important\n`, {
          tags: ["urgent", "important"],
        });
      });

      it("single value as array", () => {
        check("Tags: {tags}\n", `Tags: urgent\n`, { tags: ["urgent"] });
      });

      it("empty value as empty array", () => {
        check("**Tags:** {tags}\n", "**Tags:** \n", { tags: [] });
      });

      it("trims whitespace from elements", () => {
        check("**Tags:** {tags}\n", "**Tags:**  urgent ,  important  \n", {
          tags: ["urgent", "important"],
        });
      });
    });

    describe("multi-value formats", () => {
      it("plaintext line format with newlines", () => {
        check("{aliases}\n", "John\nJohnny\nJ\n", {
          aliases: ["John", "Johnny", "J"],
        });
      });

      it("plaintext paragraph format with blank lines", () => {
        check("{notes}\n", "First note.\n\nSecond note.\n", {
          notes: ["First note.", "Second note."],
        });
      });
    });

    describe("nested fields", () => {
      it("single relation with nested multi-value in inline position", () => {
        check("**Tags:** {project.tags}\n", "**Tags:** urgent, backend\n", {
          project: { tags: ["urgent", "backend"] },
        });
      });

      it("single relation with nested multi-value in block position", () => {
        check(
          "{project.tags}\n\nMore content.\n",
          "urgent, backend\n\nMore content.\n",
          {
            project: { tags: ["urgent", "backend"] },
          },
        );
      });
    });

    describe("single relation", () => {
      it("inline position", () => {
        check("**Project:** {project}\n", "**Project:** Project Alpha\n", {
          project: { title: "Project Alpha" },
        });
      });

      it("block position", () => {
        check(
          "{project}\n\nMore content.\n",
          "**Project Alpha**\n\nA great project.\n\nMore content.\n",
          {
            project: {
              title: "Project Alpha",
              description: "A great project.",
            },
          },
        );
      });

      it("section position", () => {
        check(
          "## Project\n\n{project}\n\n## Next\n",
          "## Project\n\n### Project Alpha\n\nA great project.\n\n## Next\n",
          {
            project: {
              title: "Project Alpha",
              description: "A great project.",
            },
          },
        );
      });

      it("document position", () => {
        check(
          "{project}\n",
          "# Project Alpha\n\n**Type:** Project\n**Key:** project-alpha\n\n## Description\n\nA great project.\n",
          {
            project: {
              title: "Project Alpha",
              type: "Project",
              key: "project-alpha",
              description: "A great project.",
            },
          },
        );
      });

      it("null value", () => {
        check("**Project:** {project}\n", "**Project:** \n", {
          project: null,
        });
      });
    });

    describe("multi-value relation", () => {
      it("default template", () => {
        check(
          "## Tasks\n\n{tasks}\n",
          "## Tasks\n\n### Task 1\n\nDescription 1\n\n### Task 2\n\nDescription 2\n",
          {
            tasks: [
              { title: "Task 1", description: "Description 1" },
              { title: "Task 2", description: "Description 2" },
            ],
          },
        );
      });

      it("empty as empty array", () => {
        check("## Tasks\n\n{tasks}\n", "## Tasks\n\n", { tasks: [] });
      });

      it("inline position", () => {
        check("**Tasks:** {tasks}\n", "**Tasks:** Task 1, Task 2\n", {
          tasks: [{ title: "Task 1" }, { title: "Task 2" }],
        });
      });

      it("block position", () => {
        check(
          "{tasks}\n\nMore content.\n",
          "**Task 1**\n\nDescription 1\n\n**Task 2**\n\nDescription 2\n\nMore content.\n",
          {
            tasks: [
              { title: "Task 1", description: "Description 1" },
              { title: "Task 2", description: "Description 2" },
            ],
          },
        );
      });

      it("document position", () => {
        check(
          "{tasks}\n",
          "# Task 1\n\n**Type:** Task\n**Key:** task-1\n\n## Description\n\nDescription 1\n\n---\n\n# Task 2\n\n**Type:** Task\n**Key:** task-2\n\n## Description\n\nDescription 2\n",
          {
            tasks: [
              {
                title: "Task 1",
                type: "Task",
                key: "task-1",
                description: "Description 1",
              },
              {
                title: "Task 2",
                type: "Task",
                key: "task-2",
                description: "Description 2",
              },
            ],
          },
        );
      });
    });

    describe("complex scenarios", () => {
      it("empty richtext field after multi-value relation block", () => {
        check(
          "# {title}\n\n## Children Summary\n\n{tasks}\n\n## Summary\n\n{description}\n",
          "# Month Title\n\n## Children Summary\n\n### Task 1\n\nDescription 1\n\n## Summary\n\n",
          {
            title: "Month Title",
            tasks: [{ title: "Task 1", description: "Description 1" }],
            description: null,
          },
        );
      });

      it("section template with trailing empty field", () => {
        const weekSummaryTemplate = createTemplateEntity(
          "week-summary",
          "### {title}\n\n{description}\n",
          { templateFormat: "section" },
        );
        check(
          "# {title}\n\n## Plan\n\n{notes}\n\n## Weeks Summary\n\n{tasks|template:week-summary}\n\n## Summary\n\n{description}\n",
          `# 2025-01

## Plan

Focus areas:
- Ship journaling schema to production

## Weeks Summary

### 2025-W01

Excellent first week. Schema is minimal and consistent.

## Summary

`,
          {
            title: "2025-01",
            notes: ["Focus areas:\n- Ship journaling schema to production"],
            tasks: [
              {
                title: "2025-W01",
                description:
                  "Excellent first week. Schema is minimal and consistent.",
              },
            ],
            description: null,
          },
          [...mockDefaultTemplates, weekSummaryTemplate],
        );
      });

      it("parses markdown with trailing empty section", () => {
        const ast = parseMarkdown("## Summary\n\n");
        expect(ast.children).toEqual([
          expect.objectContaining({ type: "heading", depth: 2 }),
        ]);
      });
    });

    describe("errors", () => {
      it("non-existent field in schema", () => {
        checkErr(
          "**Missing:** {nonExistentField}\n",
          "**Missing:** value\n",
          "field-not-found",
        );
      });

      it("non-existent nested field in schema", () => {
        checkErr(
          "**Project:** {project.nonExistentField}\n",
          `**Project:** ${mockProjectNode.title}\n`,
          "field-not-found",
        );
      });

      it("multi-relation with nested multi-value field", () => {
        checkErr(
          "{tasks.steps}\n",
          "Step 1\n\nStep 2\n",
          "nested-multi-value-not-supported",
        );
      });

      it("path with more than 2 levels", () => {
        checkErr("{project.tasks.title}\n", "Task 1\n", "nested-path-too-deep");
      });

      it("field has wrong type", () => {
        checkErr(
          "**Favorite:** {favorite}\n",
          "**Favorite:** teur\n",
          "invalid-field-value",
        );
      });

      it("literal text mismatch", () => {
        checkErr(
          "# {title}\n\n**Type:** {type}\n",
          "# My Task\n\nSome random text\n",
          "literal-mismatch",
        );
      });

      it("extra content after view", () => {
        checkErr(
          "# {title}\n",
          "# My Task\n\nExtra content\n\nMore content\n",
          "extra-content",
        );
      });
    });
  });

  describe("round-trip", () => {
    it("round-trips template with extracted fields", () => {
      const snapshot = `# Implement user authentication

**Status:** todo

## Description

Add login and registration functionality with JWT tokens
`;
      const viewAst = parseTemplate(mockTaskTemplate.templateContent);
      const snapAst = parseMarkdown(snapshot);
      const extracted = throwIfError(
        extractFieldsAst(mockNodeSchema, [], viewAst, snapAst),
      );
      const rendered = throwIfError(
        renderTemplateAst(mockNodeSchema, [], viewAst, extracted),
      );
      expect(rendered).toBe(snapshot);
    });
  });

  describe("extractFieldSlotsFromAst", () => {
    const check = (template: string, expected: string[]) => {
      const ast = parseTemplate(template);
      expect(extractFieldSlotsFromAst(ast)).toEqual(expected);
    };

    it("extracts single field slot", () => {
      check("# {title}\n", ["title"]);
    });

    it("extracts multiple field slots", () => {
      check("# {title}\n\n{description}\n", ["title", "description"]);
    });

    it("extracts nested field paths", () => {
      check("{project.title}\n", ["project.title"]);
    });

    it("returns empty array for template without slots", () => {
      check("# Static Title\n\nNo fields here\n", []);
    });

    it("ignores escaped braces", () => {
      check("\\{notASlot\\} {title}\n", ["title"]);
    });
  });

  describe("extractFieldPathsFromAst", () => {
    const check = (template: string, expected: string[][]) => {
      const ast = parseTemplate(template);
      expect(extractFieldPathsFromAst(ast)).toEqual(expected);
    };

    it("extracts single field path", () => {
      check("# {title}\n", [["title"]]);
    });

    it("extracts multiple field paths", () => {
      check("# {title}\n\n{description}\n", [["title"], ["description"]]);
    });

    it("extracts nested field paths as arrays", () => {
      check("{project.title}\n", [["project", "title"]]);
    });

    it("extracts path without modifier when slot has template modifier", () => {
      check("{children|template:task-item}\n", [["children"]]);
    });

    it("extracts path without modifier for nested path with modifier", () => {
      check("{parent.tasks|template:task-item}\n", [["parent", "tasks"]]);
    });

    it("returns empty array for template without slots", () => {
      check("# Static Title\n\nNo fields here\n", []);
    });
  });

  describe("extractFieldMappings", () => {
    const check = (
      template: string,
      document: string,
      expected: FieldSlotMapping[],
    ) => {
      const mappings = extractFieldMappings(
        parseTemplate(template),
        parseAst(document),
      );
      expect(mappings).toEqual(expected);
    };

    it("extracts position for single field in heading", () => {
      check("# {title}\n", "# My Task Title\n", [
        {
          path: ["title"],
          position: {
            start: { line: 1, column: 3, offset: 2 },
            end: { line: 1, column: 16, offset: 15 },
          },
        },
      ]);
    });

    it("extracts positions for multiple fields in different blocks", () => {
      check(
        "# {title}\n\n{description}\n",
        "# My Task\n\nTask description here\n",
        [
          {
            path: ["title"],
            position: {
              start: { line: 1, column: 3, offset: 2 },
              end: { line: 1, column: 10, offset: 9 },
            },
          },
          {
            path: ["description"],
            position: {
              start: { line: 3, column: 1, offset: 11 },
              end: { line: 3, column: 22, offset: 32 },
            },
          },
        ],
      );
    });

    it("extracts position for nested field path", () => {
      check("{author.name}\n", "John Doe\n", [
        {
          path: ["author", "name"],
          position: {
            start: { line: 1, column: 1, offset: 0 },
            end: { line: 1, column: 9, offset: 8 },
          },
        },
      ]);
    });

    it("returns empty array for template without slots", () => {
      check("# Static Title\n", "# Static Title\n", []);
    });

    it("extracts position for field with surrounding text in paragraph", () => {
      // Note: position includes leading space from " active" text node
      check("**Status:** {status}\n", "**Status:** active\n", [
        {
          path: ["status"],
          position: {
            start: { line: 1, column: 12, offset: 11 },
            end: { line: 1, column: 19, offset: 18 },
          },
        },
      ]);
    });

    it("extracts position for field rendered as list", () => {
      check("{description}\n", "- Item 1\n- Item 2\n", [
        {
          path: ["description"],
          position: {
            start: { line: 1, column: 1, offset: 0 },
            end: { line: 2, column: 9, offset: 17 },
          },
        },
      ]);
    });

    it("extracts position for field rendered as multiple paragraphs", () => {
      check("{description}\n", "First paragraph.\n\nSecond paragraph.\n", [
        {
          path: ["description"],
          position: {
            start: { line: 1, column: 1, offset: 0 },
            end: { line: 3, column: 18, offset: 35 },
          },
        },
      ]);
    });

    it("extracts position spanning multiple blocks until next static content", () => {
      check(
        "## Items\n\n{children}\n\n## End\n",
        "## Items\n\n### Child 1\n\nContent 1\n\n### Child 2\n\nContent 2\n\n## End\n",
        [
          {
            path: ["children"],
            position: {
              start: { line: 3, column: 1, offset: 10 },
              end: { line: 9, column: 10, offset: 56 },
            },
          },
        ],
      );
    });
  });
});
