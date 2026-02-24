import { describe, expect, it } from "bun:test";
import "@binder/utils/tests";
import { pick, throwIfError } from "@binder/utils";
import {
  type FieldsetNested,
  type EntityKey,
  type EntitySchema,
  coreSchema,
  mergeSchema,
  newId,
} from "@binder/db";
import {
  mockRecordSchema,
  mockProjectRecord,
  mockTask1Record,
  mockTask2Record,
  mockTask3Record,
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
  const taskItemTemplate = createTemplateEntity("task-item", "- {title}", {
    templateFormat: "line",
  });
  const whereTemplates: Templates = [...mockDefaultTemplates, taskItemTemplate];

  describe("renderTemplateAst", () => {
    const check = (
      view: string,
      data: FieldsetNested,
      expected: string,
      templates: Templates = mockDefaultTemplates,
    ) => {
      const ast = parseTemplate(view);
      const result = throwIfError(
        renderTemplateAst(mockRecordSchema, templates, ast, data),
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
      const result = renderTemplateAst(mockRecordSchema, templates, ast, data);
      expect(result).toBeErrWithKey(expectedKey);
    };

    describe("scalar fields", () => {
      it("single field in heading", () => {
        check("# {title}\n", mockTask1Record, `# ${mockTask1Record.title}\n`);
      });

      it("multiple fields", () => {
        check(
          "# {title}\n\n**Status:** {status}\n",
          mockTask1Record,
          `# ${mockTask1Record.title}\n\n**Status:** ${mockTask1Record.status}\n`,
        );
      });

      it("multiple slots in same paragraph", () => {
        check(
          "{title} ({status})\n",
          mockTask1Record,
          `${mockTask1Record.title} (${mockTask1Record.status})\n`,
        );
      });

      it("adjacent slots without separator", () => {
        check(
          "{title}{status}\n",
          mockTask1Record,
          `${mockTask1Record.title}${mockTask1Record.status}\n`,
        );
      });

      it("escaped braces", () => {
        check(
          "\\{title\\} {title}\n",
          mockTask1Record,
          `{title} ${mockTask1Record.title}\n`,
        );
      });

      it("strong formatting around slot", () => {
        check(
          "**{title}**\n",
          pick(mockTask1Record, ["title"]),
          `**${mockTask1Record.title}**\n`,
        );
      });

      it("nested field value", () => {
        check(
          "**Project:** {project.title}\n",
          { project: mockProjectRecord },
          `**Project:** ${mockProjectRecord.title}\n`,
        );
      });
    });

    describe("scalar field types", () => {
      it("number as string", () => {
        check("**ID:** {id}\n", mockTask1Record, "**ID:** 1\n");
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
        check("> {title}\n", mockTask1Record, `> ${mockTask1Record.title}\n`);
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
          { tasks: [mockTask2Record, mockTask3Record] },
          `${mockTask2Record.title}, ${mockTask3Record.title}, and more\n`,
        );
      });

      it("multi-value nested plaintext in line position", () => {
        check(
          "**Tasks:** {tasks.title}\n",
          { tasks: [mockTask2Record, mockTask3Record] },
          `**Tasks:** ${mockTask2Record.title}\n${mockTask3Record.title}\n`,
        );
      });

      it("multi-value nested plaintext in block position", () => {
        check(
          "{tasks.title}\n\nMore content.\n",
          { tasks: [mockTask2Record, mockTask3Record] },
          `${mockTask2Record.title}\n\n${mockTask3Record.title}\n\nMore content.\n`,
        );
      });

      it("multi-value nested richtext in line position", () => {
        check(
          "**Descriptions:** {tasks.description}\n",
          { tasks: [mockTask2Record, mockTask3Record] },
          `**Descriptions:** ${mockTask2Record.description}\n${mockTask3Record.description}\n`,
        );
      });

      it("multi-value nested richtext in block position", () => {
        check(
          "{tasks.description}\n\nMore content.\n",
          { tasks: [mockTask2Record, mockTask3Record] },
          `${mockTask2Record.description}\n\n${mockTask3Record.description}\n\nMore content.\n`,
        );
      });

      it("empty multi-value nested field as empty string", () => {
        check("**Tasks:** {tasks.title}\n", { tasks: [] }, "**Tasks:** \n");
      });

      it("single relation with nested multi-value in inline position", () => {
        check(
          "**Tags:** {project.tags}\n",
          { project: { ...mockProjectRecord, tags: ["urgent", "backend"] } },
          "**Tags:** urgent, backend\n",
        );
      });

      it("single relation with nested multi-value in block position", () => {
        check(
          "{project.tags}\n\nMore content.\n",
          { project: { ...mockProjectRecord, tags: ["urgent", "backend"] } },
          "urgent, backend\n\nMore content.\n",
        );
      });
    });

    describe("single relation", () => {
      it("inline position", () => {
        check(
          "**Project:** {project}\n",
          { project: mockProjectRecord },
          `**Project:** ${mockProjectRecord.title}\n`,
        );
      });

      it("block position", () => {
        check(
          "{project}\n\nMore content below.\n",
          { project: mockProjectRecord },
          `**${mockProjectRecord.title}**\n\n${mockProjectRecord.description}\n\nMore content below.\n`,
        );
      });

      it("section position", () => {
        check(
          "## Project\n\n{project}\n\n## Next\n",
          { project: mockProjectRecord },
          `## Project\n\n### ${mockProjectRecord.title}\n\n${mockProjectRecord.description}\n\n## Next\n`,
        );
      });

      it("document position", () => {
        check(
          "{project}\n",
          { project: mockProjectRecord },
          `# ${mockProjectRecord.title}\n\n**Type:** ${mockProjectRecord.type}\n**Key:** ${mockProjectRecord.key}\n\n## Description\n\n${mockProjectRecord.description}\n`,
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
          { project: mockProjectRecord },
          `**Project:** **${mockProjectRecord.title}** (${mockProjectRecord.status})\n`,
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
            tasks: [mockTask2Record, mockTask3Record],
          },
          `## Tasks\n\n### ${mockTask2Record.title}\n\n${mockTask2Record.description}\n\n### ${mockTask3Record.title}\n\n${mockTask3Record.description}\n`,
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
          { tasks: [mockTask2Record, mockTask3Record] },
          `## Tasks\n\n- ${mockTask2Record.title}: ${mockTask2Record.status}\n- ${mockTask3Record.title}: ${mockTask3Record.status}\n`,
          [template],
        );
      });

      it("template key lookup", () => {
        const template = createTemplateEntity("task-item", "- **{title}**", {
          templateFormat: "line",
        });

        check(
          "{tasks|template:task-item}\n",
          { tasks: [mockTask2Record, mockTask3Record] },
          `- **${mockTask2Record.title}**\n- **${mockTask3Record.title}**\n`,
          [template],
        );
      });

      it("empty as empty string", () => {
        check("## Tasks\n\n{tasks}\n", { tasks: [] }, "## Tasks\n\n");
      });

      it("inline position", () => {
        check(
          "**Tasks:** {tasks}\n",
          { tasks: [mockTask2Record, mockTask3Record] },
          `**Tasks:** ${mockTask2Record.title}, ${mockTask3Record.title}\n`,
        );
      });

      it("block position", () => {
        check(
          "{tasks}\n\nMore content below.\n",
          { tasks: [mockTask2Record, mockTask3Record] },
          `**${mockTask2Record.title}**\n\n${mockTask2Record.description}\n\n**${mockTask3Record.title}**\n\n${mockTask3Record.description}\n\nMore content below.\n`,
        );
      });

      it("section position", () => {
        check(
          "## Tasks\n\n{tasks}\n\n## Next\n",
          { tasks: [mockTask2Record, mockTask3Record] },
          `## Tasks\n\n### ${mockTask2Record.title}\n\n${mockTask2Record.description}\n\n### ${mockTask3Record.title}\n\n${mockTask3Record.description}\n\n## Next\n`,
        );
      });

      it("document position", () => {
        check(
          "{tasks}\n",
          { tasks: [mockTask2Record, mockTask3Record] },
          `# ${mockTask2Record.title}\n\n**Type:** ${mockTask2Record.type}\n**Key:** ${mockTask2Record.key}\n\n## Description\n\n${mockTask2Record.description}\n\n---\n\n# ${mockTask3Record.title}\n\n**Type:** ${mockTask3Record.type}\n**Key:** ${mockTask3Record.key}\n\n## Description\n\n${mockTask3Record.description}\n`,
        );
      });
    });

    describe("where: filter", () => {
      it("filters multi-value relation in section position", () => {
        const view = `## Pending\n\n{tasks|where:status=pending|template:task-item}\n\n## Active\n\n{tasks|where:status=active|template:task-item}\n`;
        const data = {
          tasks: [mockTask1Record, mockTask2Record, mockTask3Record],
        };
        // task1 and task2 are pending, task3 is active
        check(
          view,
          data,
          `## Pending\n\n- ${mockTask1Record.title}\n- ${mockTask2Record.title}\n\n## Active\n\n- ${mockTask3Record.title}\n`,
          whereTemplates,
        );
      });

      it("where: with no matches produces empty section", () => {
        const view = `## Cancelled\n\n{tasks|where:status=cancelled|template:task-item}\n\n## Active\n\n{tasks|where:status=active|template:task-item}\n`;
        const data = { tasks: [mockTask3Record] };
        check(
          view,
          data,
          `## Cancelled\n\n## Active\n\n- ${mockTask3Record.title}\n`,
          whereTemplates,
        );
      });

      it("where: with multiple conditions (AND)", () => {
        const view = `{tasks|where:status=pending AND priority=medium|template:task-item}\n`;
        const data = {
          tasks: [
            mockTask1Record, // pending, medium
            mockTask3Record, // active, medium
          ],
        };
        check(view, data, `- ${mockTask1Record.title}\n`, whereTemplates);
      });

      it("where: combined with template:", () => {
        const sectionTemplate = createTemplateEntity(
          "task-section",
          `### {title}\n\n{description}\n`,
          { templateFormat: "section" },
        );
        const templates: Templates = [...mockDefaultTemplates, sectionTemplate];
        const view = `## Active Tasks\n\n{tasks|where:status=active|template:task-section}\n\n## End\n`;
        const data = { tasks: [mockTask1Record, mockTask3Record] };
        check(
          view,
          data,
          `## Active Tasks\n\n### ${mockTask3Record.title}\n\n${mockTask3Record.description}\n\n## End\n`,
          templates,
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
          { project: mockProjectRecord },
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
          { project: mockProjectRecord },
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
          { project: mockProjectRecord },
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
      base: FieldsetNested = {},
    ) => {
      const viewAst = parseTemplate(view);
      const snapAst = parseMarkdown(output);
      const result = throwIfError(
        extractFieldsAst(mockRecordSchema, templates, viewAst, snapAst, base),
      );
      expect(result).toEqual(expected);
    };

    const checkError = (
      view: string,
      output: string,
      expectedKey: string,
      base: FieldsetNested = {},
    ) => {
      const ast = parseTemplate(view);
      const snapAst = parseMarkdown(output);
      const result = extractFieldsAst(
        mockRecordSchema,
        mockDefaultTemplates,
        ast,
        snapAst,
        base,
      );
      expect(result).toBeErrWithKey(expectedKey);
    };

    describe("scalar fields", () => {
      it("single field", () => {
        check(
          "# {title}\n",
          `# ${mockTask1Record.title}\n`,
          pick(mockTask1Record, ["title"]),
        );
      });

      it("multiple fields", () => {
        check(
          "# {title}\n\n**Status:** {status}\n",
          `# ${mockTask1Record.title}\n\n**Status:** ${mockTask1Record.status}\n`,
          pick(mockTask1Record, ["title", "status"]),
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
          `{title} ${mockTask1Record.title}\n`,
          pick(mockTask1Record, ["title"]),
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
          `#   ${mockTask1Record.title}  \n`,
          pick(mockTask1Record, ["title"]),
        );
      });

      it("nested field value", () => {
        check(
          "**Project:** {project.title}\n",
          `**Project:** ${mockProjectRecord.title}\n`,
          { project: pick(mockProjectRecord, ["title"]) },
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

      it("section template with empty block fields in some entities", () => {
        const journalSchema = mergeSchema(coreSchema(), {
          fields: {
            dayPeriod: {
              id: newId(100, 0),
              key: "dayPeriod" as EntityKey,
              name: "Day Period",
              dataType: "period",
              periodFormat: "day",
            },
            summary: {
              id: newId(101, 0),
              key: "summary" as EntityKey,
              name: "Summary",
              dataType: "richtext",
              richtextFormat: "block",
            },
          },
          types: {},
        }) as EntitySchema;

        const daySummaryTemplate = createTemplateEntity(
          "day-summary",
          "### {dayPeriod}\n\n{summary}\n",
          { templateFormat: "section" },
        );

        const viewAst = parseTemplate(
          "## Days Summary\n\n{children|template:day-summary}\n\n## Summary\n\n{description}\n",
        );
        const snapAst = parseMarkdown(
          "## Days Summary\n\n### 2026-02-09\n\n### 2026-02-10\n\nGood day.\n\n## Summary\n\n",
        );
        const result = throwIfError(
          extractFieldsAst(
            journalSchema,
            [...mockDefaultTemplates, daySummaryTemplate],
            viewAst,
            snapAst,
            {},
          ),
        );
        expect(result).toEqual({
          children: [
            { dayPeriod: "2026-02-09", summary: null },
            { dayPeriod: "2026-02-10", summary: "Good day." },
          ],
          description: null,
        });
      });

      it("section template with empty block fields and realistic base produces sparse diff", () => {
        // Regression: when base={} was passed for owned children, the field
        // accumulator stored null tombstones for empty fields (summary: null)
        // because isEqual(null, undefined) is false. These tombstones leaked
        // through diffOwnedChildren → matchEntities → compareFieldValues →
        // assertIsArray(null), crashing the sync.
        //
        // The fix threads the parent's base children into extraction so the
        // accumulator sees base.summary === null and skips the unchanged field.
        const journalSchema = mergeSchema(coreSchema(), {
          fields: {
            dayPeriod: {
              id: newId(100, 0),
              key: "dayPeriod" as EntityKey,
              name: "Day Period",
              dataType: "period",
              periodFormat: "day",
            },
            summary: {
              id: newId(101, 0),
              key: "summary" as EntityKey,
              name: "Summary",
              dataType: "richtext",
              richtextFormat: "block",
            },
          },
          types: {},
        }) as EntitySchema;

        const daySummaryTemplate = createTemplateEntity(
          "day-summary",
          "### {dayPeriod}\n\n{summary}\n",
          { templateFormat: "section" },
        );

        const viewAst = parseTemplate(
          "## Days Summary\n\n{children|template:day-summary}\n\n## Summary\n\n{description}\n",
        );
        const snapAst = parseMarkdown(
          "## Days Summary\n\n### 2026-02-24\n\n### 2026-02-25\n\nGood day.\n\n## Summary\n\n",
        );

        // Realistic base: DB state with existing children that have uids
        // and summary already null (empty day entries)
        const base = {
          children: [
            {
              uid: "_day24000001",
              dayPeriod: "2026-02-24",
              summary: null,
            },
            {
              uid: "_day25000002",
              dayPeriod: "2026-02-25",
              summary: null,
            },
          ],
          description: null,
        };

        const result = throwIfError(
          extractFieldsAst(
            journalSchema,
            [...mockDefaultTemplates, daySummaryTemplate],
            viewAst,
            snapAst,
            base,
          ),
        );

        // With the fix, extraction with a proper base skips unchanged fields.
        // The first child has no changes (dayPeriod and summary match base).
        // The second child only has summary changed from null to "Good day."
        // No spurious null tombstones appear.
        expect(result).toEqual({
          children: [
            {},
            { summary: "Good day." },
          ],
        });
      });
    });

    describe("where: filter extraction", () => {
      it("extracts from two where: sections and concatenates entities", () => {
        check(
          `## Pending\n\n{tasks|where:status=pending|template:task-item}\n\n## Active\n\n{tasks|where:status=active|template:task-item}\n`,
          `## Pending\n\n- Write docs\n- Create logo\n\n## Active\n\n- Markdown support\n`,
          {
            tasks: [
              { title: "Write docs", status: "pending" },
              { title: "Create logo", status: "pending" },
              { title: "Markdown support", status: "active" },
            ],
          },
          whereTemplates,
        );
      });

      it("empty where: section contributes no entities", () => {
        check(
          `## Pending\n\n{tasks|where:status=pending|template:task-item}\n\n## Active\n\n{tasks|where:status=active|template:task-item}\n`,
          `## Pending\n\n## Active\n\n- Markdown support\n`,
          {
            tasks: [{ title: "Markdown support", status: "active" }],
          },
          whereTemplates,
        );
      });

      it("single where: section extracts with injected fields", () => {
        check(
          `## Active\n\n{tasks|where:status=active|template:task-item}\n`,
          `## Active\n\n- Task one\n`,
          {
            tasks: [{ title: "Task one", status: "active" }],
          },
          whereTemplates,
        );
      });
    });

    describe("errors", () => {
      it("non-existent field in schema", () => {
        checkError(
          "**Missing:** {nonExistentField}\n",
          "**Missing:** value\n",
          "field-not-found",
        );
      });

      it("non-existent nested field in schema", () => {
        checkError(
          "**Project:** {project.nonExistentField}\n",
          `**Project:** ${mockProjectRecord.title}\n`,
          "field-not-found",
        );
      });

      it("multi-relation with nested multi-value field", () => {
        checkError(
          "{tasks.steps}\n",
          "Step 1\n\nStep 2\n",
          "nested-multi-value-not-supported",
        );
      });

      it("path with more than 2 levels", () => {
        checkError(
          "{project.tasks.title}\n",
          "Task 1\n",
          "nested-path-too-deep",
        );
      });

      it("field has wrong type", () => {
        checkError(
          "**Favorite:** {favorite}\n",
          "**Favorite:** teur\n",
          "invalid-field-value",
        );
      });

      it("literal text mismatch", () => {
        checkError(
          "# {title}\n\n**Type:** {type}\n",
          "# My Task\n\nSome random text\n",
          "literal-mismatch",
        );
      });

      it("extra content after view", () => {
        checkError(
          "# {title}\n",
          "# My Task\n\nExtra content\n\nMore content\n",
          "extra-content",
        );
      });
    });

    describe("duplicate field slots", () => {
      it("detects conflict when duplicate inline slots have different values", () => {
        checkError(
          "# {title}\n\n**Title again:** {title}\n",
          "# Title A\n\n**Title again:** Title B\n",
          "field-conflict",
        );
      });

      it("detects conflict when duplicate block slots have different values", () => {
        checkError(
          "## Notes\n\n{description}\n\n## Notes Copy\n\n{description}\n",
          "## Notes\n\nFirst version of notes\n\n## Notes Copy\n\nSecond version of notes\n",
          "field-conflict",
        );
      });

      it("ignores duplicate slot value that matches base", () => {
        check(
          "# {title}\n\n**Title again:** {title}\n",
          "# New Title\n\n**Title again:** Original Title\n",
          { title: "New Title" },
          mockDefaultTemplates,
          { title: "Original Title" },
        );
      });

      it("returns empty when both duplicate slots match base", () => {
        check(
          "# {title}\n\n**Title again:** {title}\n",
          "# Original Title\n\n**Title again:** Original Title\n",
          {},
          mockDefaultTemplates,
          { title: "Original Title" },
        );
      });
    });
  });

  describe("round-trip", () => {
    const checkRoundTrip = (
      view: string,
      snapshot: string,
      expected: FieldsetNested,
      templates: Templates = mockDefaultTemplates,
    ) => {
      const viewAst = parseTemplate(view);
      const snapAst = parseMarkdown(snapshot);
      const extracted = throwIfError(
        extractFieldsAst(mockRecordSchema, templates, viewAst, snapAst, {}),
      );
      expect(extracted).toEqual(expected);
      const rendered = throwIfError(
        renderTemplateAst(mockRecordSchema, templates, viewAst, extracted),
      );
      expect(rendered).toBe(snapshot);
    };

    it("where-filtered relation sections", () => {
      checkRoundTrip(
        `# {title}\n\n{description}\n\n## Pending\n\n{tasks|where:status=pending|template:task-item}\n\n## Active\n\n{tasks|where:status=active|template:task-item}\n`,
        `# Pre-Launch\n\nPrepare for release.\n\n## Pending\n\n- Write docs\n- Create logo\n\n## Active\n\n- Markdown support\n`,
        {
          title: "Pre-Launch",
          description: "Prepare for release.",
          tasks: [
            { title: "Write docs", status: "pending" },
            { title: "Create logo", status: "pending" },
            { title: "Markdown support", status: "active" },
          ],
        },
        whereTemplates,
      );
    });

    it("extracted fields", () => {
      checkRoundTrip(
        mockTaskTemplate.templateContent,
        `# Implement user authentication\n\n**Status:** todo\n\n## Description\n\nAdd login and registration functionality with JWT tokens\n`,
        {
          title: "Implement user authentication",
          status: "todo",
          description:
            "Add login and registration functionality with JWT tokens",
        },
        [],
      );
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

  describe("parseMarkdown", () => {
    it("trailing empty section produces only heading node", () => {
      const ast = parseMarkdown("## Summary\n\n");
      expect(ast.children).toEqual([
        expect.objectContaining({ type: "heading", depth: 2 }),
      ]);
    });
  });
});
