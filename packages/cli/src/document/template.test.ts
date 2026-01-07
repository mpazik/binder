import { describe, expect, it } from "bun:test";
import "@binder/utils/tests";
import { throwIfError, pick } from "@binder/utils";
import type { FieldsetNested } from "@binder/db";
import {
  mockNodeSchema,
  mockTask1Node,
  mockProjectNode,
} from "@binder/db/mocks";
import { renderTemplate, extractFields, parseTemplate } from "./template.ts";
import { parseMarkdown } from "./markdown.ts";

describe("view", () => {
  describe("renderTemplate", () => {
    const check = (
      view: string,
      data: FieldsetNested,
      expectedOutput: string,
    ) => {
      const ast = parseTemplate(view);
      const result = throwIfError(renderTemplate(mockNodeSchema, ast, data));
      expect(result).toBe(expectedOutput);
    };

    it("renders simple view with single field", () => {
      check("# {title}\n", mockTask1Node, `# ${mockTask1Node.title}\n`);
    });

    it("renders view with multiple fields", () => {
      check(
        "# {title}\n\n**Status:** {status}\n",
        mockTask1Node,
        `# ${mockTask1Node.title}\n\n**Status:** ${mockTask1Node.status}\n`,
      );
    });

    it("escapes plaintext field value that contains formatting", () => {
      check(
        "{title}\n",
        { title: "**Bold Title**" },
        "\\*\\*Bold Title\\*\\*\n",
      );
    });

    it("preserves richtext field value formatting", () => {
      check(
        "{description}\n",
        { description: "**Bold Description**" },
        "**Bold Description**\n",
      );
    });

    it("renders block-level richtext with headers as block content", () => {
      // templates field has richtextFormat: "document" which allows headers
      check(
        "{templates}\n",
        { templates: "# Heading\n\nParagraph text" },
        "# Heading\n\nParagraph text\n",
      );
    });

    it("renders block-level richtext with lists as block content", () => {
      // chapters field has richtextFormat: "section" which allows lists
      check(
        "{chapters}\n",
        { chapters: "- Item one\n- Item two" },
        "- Item one\n- Item two\n",
      );
    });

    it("renders null fields as empty string", () => {
      check("**Email:** {email}\n", { email: null }, "**Email:** \n");
    });

    it("renders undefined fields as empty string", () => {
      check("**Email:** {email}\n", {}, "**Email:** \n");
    });

    it("renders number fields as string", () => {
      check("**ID:** {id}\n", mockTask1Node, "**ID:** 1\n");
    });

    it("renders boolean fields as true/false", () => {
      check(
        "**Active:** {active}\n**Done:** {done}\n",
        { active: true, done: false },
        "**Active:** true\n**Done:** false\n",
      );
    });

    it("renders nested field values", () => {
      check(
        "**Project:** {project.title}\n",
        { project: mockProjectNode },
        `**Project:** ${mockProjectNode.title}\n`,
      );
    });

    it("handles escaped braces", () => {
      check(
        "\\{title\\} {title}\n",
        mockTask1Node,
        `{title} ${mockTask1Node.title}\n`,
      );
    });

    it("handles multi-line field values", () => {
      check(
        "{description}\n",
        { description: "Line one\nLine two" },
        "Line one\nLine two\n",
      );
    });

    it("renders non-existent field as empty string", () => {
      check("**Missing:** {nonExistentField}\n", {}, "**Missing:** \n");
    });

    it("renders non-existent nested field as empty string", () => {
      check(
        "**Project:** {project.nonExistentField}\n",
        { project: mockProjectNode },
        "**Project:** \n",
      );
    });

    it("renders empty string value", () => {
      check(
        "**Description:** {description}\n",
        { description: "" },
        "**Description:** \n",
      );
    });

    it("renders null number field as empty string", () => {
      check("**ID:** {id}\n", { id: null }, "**ID:** \n");
    });

    it("renders array fields as comma-separated values", () => {
      check(
        "**Tags:** {tags}\n",
        { tags: ["urgent", "important"] },
        "**Tags:** urgent, important\n",
      );
    });

    it("renders empty array as empty string", () => {
      check("**Tags:** {tags}\n", { tags: [] }, "**Tags:** \n");
    });

    it("renders single element array", () => {
      check("**Tags:** {tags}\n", { tags: ["urgent"] }, "**Tags:** urgent\n");
    });
  });

  describe("extractFields", () => {
    const check = (
      view: string,
      output: string,
      expectedData: FieldsetNested,
    ) => {
      const viewAst = parseTemplate(view);
      const snapAsp = parseMarkdown(output);
      const result = throwIfError(
        extractFields(mockNodeSchema, viewAst, snapAsp),
      );
      expect(result).toEqual(expectedData);
    };

    const checkIfError = (
      view: string,
      output: string,
      expectedErrorKey: string,
    ) => {
      const ast = parseTemplate(view);
      const snapAsp = parseMarkdown(output);
      const result = extractFields(mockNodeSchema, ast, snapAsp);
      expect(result).toBeErrWithKey(expectedErrorKey);
    };

    it("extracts single field", () => {
      check(
        "# {title}\n",
        `# ${mockTask1Node.title}\n`,
        pick(mockTask1Node, ["title"]),
      );
    });

    it("extracts multiple fields", () => {
      check(
        "# {title}\n\n**Status:** {status}\n",
        `# ${mockTask1Node.title}\n\n**Status:** ${mockTask1Node.status}\n`,
        pick(mockTask1Node, ["title", "status"]),
      );
    });

    it("extracts number as string if string data type", () => {
      check("**Title:** {title}\n", `**Title:** 1\n`, { title: "1" });
    });

    it("extracts number as number if string number type", () => {
      check("**Id:** {id}\n", `**Id:** 1\n`, { id: 1 });
    });

    it("extracts boolean as string if string data type", () => {
      check("**Title:** {title}\n", `**Title:** true\n`, { title: "true" });
    });

    it("extracts boolean as number if string number type", () => {
      check("**Favorite:** {favorite}\n", `**Favorite:** true\n`, {
        favorite: true,
      });
    });

    it("extracts empty and whitespace-only fields as null", () => {
      check("**Email:** {email}\n", "**Email:** \n", {
        email: null,
      });
    });

    it("trims whitespace from extracted values", () => {
      check(
        "# {title}\n",
        `#   ${mockTask1Node.title}  \n`,
        pick(mockTask1Node, ["title"]),
      );
    });

    it("extracts multi-line field values", () => {
      check("{description}\n", "Line one\nLine two\n", {
        description: "Line one\nLine two",
      });
    });

    it("handles escaped braces in view", () => {
      check(
        "\\{title\\} {title}\n",
        `{title} ${mockTask1Node.title}\n`,
        pick(mockTask1Node, ["title"]),
      );
    });

    it("extracts nested field values", () => {
      check(
        "**Project:** {project.title}\n",
        `**Project:** ${mockProjectNode.title}\n`,
        {
          project: pick(mockProjectNode, ["title"]),
        },
      );
    });

    it("extracts comma-separated values as array", () => {
      check("Tags: {tags}\n", `Tags: urgent, important\n`, {
        tags: ["urgent", "important"],
      });
    });

    it("extracts single value as array for multiple-value fields", () => {
      check("Tags: {tags}\n", `Tags: urgent\n`, {
        tags: ["urgent"],
      });
    });

    it("extracts empty value as empty array for multiple-value fields", () => {
      check("**Tags:** {tags}\n", "**Tags:** \n", {
        tags: [],
      });
    });

    it("trims whitespace from array elements", () => {
      check("**Tags:** {tags}\n", "**Tags:**  urgent ,  important  \n", {
        tags: ["urgent", "important"],
      });
    });

    it("extracts empty string value for string fields", () => {
      check("**Description:** {description}\n", "**Description:** \n", {
        description: null,
      });
    });

    it("extracts empty value as null for number fields", () => {
      check("ID: {id}\n", `ID: \n`, {
        id: null,
      });
    });

    it("extracts field with formatting around slot", () => {
      check("**{title}**\n", "**Task 1**\n", { title: "Task 1" });
    });

    it("extracts two fields with formatting around first", () => {
      check("**{title}**: {description}\n", "**Task 1**: Description 1\n", {
        title: "Task 1",
        description: "Description 1",
      });
    });

    it("returns error when field does not exist in schema", () => {
      checkIfError(
        "**Missing:** {nonExistentField}\n",
        "**Missing:** value\n",
        "field-not-found",
      );
    });

    it("returns error when nested field does not exist in schema", () => {
      checkIfError(
        "**Project:** {project.nonExistentField}\n",
        `**Project:** ${mockProjectNode.title}\n`,
        "field-not-found",
      );
    });

    it("returns error when field has wrong type", () => {
      checkIfError(
        "**Favorite:** {favorite}\n",
        "**Favorite:** teur\n",
        "invalid-field-value",
      );
    });

    it("returns error when literal text mismatches", () => {
      checkIfError(
        "# {title}\n\n**Type:** {type}\n",
        "# My Task\n\nSome random text\n",
        "literal-mismatch",
      );
    });

    it("returns error when extra content after view", () => {
      checkIfError(
        "# {title}\n",
        "# My Task\n\nExtra content\n\nMore content\n",
        "extra-content",
      );
    });
  });

  describe("round-trip", () => {
    it("round-trips task view from test data files", async () => {
      const viewContent = await Bun.file(
        `${import.meta.dir}/../../test/data/task-view.md`,
      ).text();
      const docContent = await Bun.file(
        `${import.meta.dir}/../../test/data/task-snapshot.md`,
      ).text();

      const viewAst = parseTemplate(viewContent);
      const snapAsp = parseMarkdown(docContent);
      const extracted = throwIfError(
        extractFields(mockNodeSchema, viewAst, snapAsp),
      );
      const rendered = throwIfError(
        renderTemplate(mockNodeSchema, viewAst, extracted),
      );
      expect(rendered).toBe(docContent);
    });
  });
});
