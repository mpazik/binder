import { join } from "path";
import { fileURLToPath } from "url";
import { beforeEach, describe, expect, it } from "bun:test";
import { throwIfError } from "@binder/utils";
import "@binder/utils/tests";
import { type KnowledgeGraph, openKnowledgeGraph } from "@binder/db";
import { getTestDatabase, mockTask1Node, mockTask1Uid } from "@binder/db/mocks";
import { BINDER_DIR } from "../config.ts";
import type { Config } from "../bootstrap.ts";
import { documentSchemaTransactionInput } from "./document-schema.ts";
import {
  mockCoreTransactionInputForDocs,
  mockDocumentTransactionInput,
} from "./document.mock.ts";
import { parseFile, synchronizeFile } from "./synchronizer.ts";
import { diffNodeTrees } from "./tree-diff.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

describe("synchronizer", () => {
  let kg: KnowledgeGraph;
  const docsPath = join(__dirname, "../../test/data");
  const config: Config = {
    author: "test",
    dynamicDirectories: [],
    paths: {
      root: join(__dirname, "../../test"),
      binder: join(__dirname, "../../test", BINDER_DIR),
      docs: docsPath,
    },
  };

  beforeEach(async () => {
    const db = getTestDatabase();
    kg = openKnowledgeGraph(db);
    throwIfError(await kg.update(documentSchemaTransactionInput));
    throwIfError(await kg.update(mockCoreTransactionInputForDocs));
    throwIfError(await kg.update(mockDocumentTransactionInput));
  });

  describe("parseFile", () => {
    it("parses file and returns file and kg representations", async () => {
      const filePath = join(config.paths.docs, "document.md");
      const markdown = await Bun.file(filePath).text();

      const result = throwIfError(
        await parseFile(markdown, filePath, config, kg),
      );

      expect(result.file).toEqual({
        type: "Document",
        blockContent: [
          {
            type: "Section",
            title: "Simple Markdown Document",
            blockContent: [
              {
                type: "Paragraph",
                textContent: "This is a simple markdown document.",
              },
            ],
          },
          {
            type: "Section",
            title: "Key Features",
            blockContent: [
              {
                type: "Paragraph",
                textContent: "Supports:",
              },
              {
                type: "List",
                blockContent: [
                  {
                    type: "ListItem",
                    textContent: "**Bold** text for emphasis",
                  },
                  {
                    type: "ListItem",
                    textContent: "_Italic_ text for subtle emphasis",
                  },
                  {
                    type: "ListItem",
                    textContent: "`Code snippets` for technical content",
                  },
                ],
              },
              {
                type: "Dataview",
                query: { filters: { type: "Task" } },
                template: "**{{title}}**: {{description}}",
                data: [
                  {
                    title: "Implement user authentication",
                    description:
                      "Add login and registration functionality with JWT tokens",
                  },
                  {
                    title: "Implement schema generator",
                    description: "Create a dynamic schema generator",
                  },
                ],
              },
            ],
          },
          {
            type: "Section",
            title: "Paragraphs",
            blockContent: [
              {
                type: "Paragraph",
                textContent:
                  "Paragraphs separated by blank lines for readability.",
              },
              {
                type: "Paragraph",
                textContent:
                  "Inline formatting like bold,\nitalics, code possible.",
              },
            ],
          },
        ],
      });
      expect(result.kg).toMatchObject(result.file);
    });

    it("parses task from dynamic directory", async () => {
      const configWithDynamicDir: Config = {
        ...config,
        dynamicDirectories: [
          {
            path: "tasks/{key}.md",
            query: "type=Task",
          },
        ],
      };

      const filePath = join(
        configWithDynamicDir.paths.docs,
        "tasks",
        "task-implement-user-auth.md",
      );
      const markdown = `# ${mockTask1Node.title}

**Type:** Task
**UID:** ${mockTask1Node.uid}
**Key:** ${mockTask1Node.key}

## Description

${mockTask1Node.description}`;

      const result = throwIfError(
        await parseFile(markdown, filePath, configWithDynamicDir, kg),
      );

      expect(result.file).toEqual({
        type: "Task",
        uid: mockTask1Node.uid,
        key: mockTask1Node.key,
        title: mockTask1Node.title,
        description: mockTask1Node.description,
      });

      expect(result.kg).toMatchObject({
        uid: mockTask1Node.uid,
        type: "Task",
        key: mockTask1Node.key,
        title: mockTask1Node.title,
        description: mockTask1Node.description,
      });
    });
  });

  describe("synchronizeFile", async () => {
    const filePath = join(config.paths.docs, "document.md");
    const originalMarkdown = await Bun.file(filePath).text();

    it("generates no changesets when dataview items match query results", async () => {
      const parseResult = throwIfError(
        await parseFile(originalMarkdown, filePath, config, kg),
      );

      const diffResult = throwIfError(
        diffNodeTrees(parseResult.file, parseResult.kg),
      );

      expect(diffResult).toEqual([]);
    });

    it("detects changes when document is modified", async () => {
      const parseResult = throwIfError(
        await parseFile(originalMarkdown, filePath, config, kg),
      );

      const modifiedMarkdown = originalMarkdown.replace(
        "Simple Markdown Document",
        "Modified Markdown Document",
      );

      const modifiedParseResult = throwIfError(
        await parseFile(modifiedMarkdown, filePath, config, kg),
      );

      const diffResult = throwIfError(
        diffNodeTrees(modifiedParseResult.file, parseResult.kg),
      );

      expect(diffResult.length).toBeGreaterThan(0);
      expect(diffResult[0]).toEqual(
        expect.objectContaining({
          $ref: expect.any(String),
          title: "Modified Markdown Document",
        }),
      );
    });

    it("detects new sections added to document", async () => {
      const parseResult = throwIfError(
        await parseFile(originalMarkdown, filePath, config, kg),
      );

      const modifiedMarkdown =
        originalMarkdown + "\n## New Section\nNew content here.";

      const modifiedParseResult = throwIfError(
        await parseFile(modifiedMarkdown, filePath, config, kg),
      );

      const diffResult = throwIfError(
        diffNodeTrees(modifiedParseResult.file, parseResult.kg),
      );

      const newSections = diffResult.filter(
        (change) => !("$ref" in change) && change.type === "Section",
      );
      expect(newSections.length).toBeGreaterThan(0);
      expect(newSections[0]).toEqual(
        expect.objectContaining({
          type: "Section",
          title: "New Section",
        }),
      );
    });

    it("detects paragraph content changes", async () => {
      const parseResult = throwIfError(
        await parseFile(originalMarkdown, filePath, config, kg),
      );

      const modifiedMarkdown = originalMarkdown.replace(
        "This is a simple markdown document.",
        "This is a modified markdown document with new text.",
      );

      const modifiedParseResult = throwIfError(
        await parseFile(modifiedMarkdown, filePath, config, kg),
      );

      const diffResult = throwIfError(
        diffNodeTrees(modifiedParseResult.file, parseResult.kg),
      );

      const paragraphUpdates = diffResult.filter(
        (change) => "$ref" in change && "textContent" in change,
      );
      expect(paragraphUpdates.length).toBeGreaterThan(0);
      expect(paragraphUpdates[0]).toEqual(
        expect.objectContaining({
          $ref: expect.any(String),
          textContent: "This is a modified markdown document with new text.",
        }),
      );
    });

    it("applies changes to knowledge graph", async () => {
      const modifiedMarkdown = originalMarkdown.replace(
        "Simple Markdown Document",
        "Updated Markdown Document",
      );

      const transaction = throwIfError(
        await synchronizeFile(modifiedMarkdown, filePath, config, kg),
      );

      expect(transaction).toMatchObject({
        author: "test",
        nodes: expect.arrayContaining([
          expect.objectContaining({
            $ref: "n1G4RYLpqCy",
            title: "Updated Markdown Document",
          }),
        ]),
      });
    });

    it("detects changes to individual dataview items", async () => {
      const modifiedMarkdown = originalMarkdown.replace(
        "Implement user authentication",
        "Implement user authentication system",
      );

      const result = await synchronizeFile(
        modifiedMarkdown,
        filePath,
        config,
        kg,
      );

      expect(result).toBeOk();
      const transaction = throwIfError(result);
      expect(transaction).toMatchObject({
        author: "test",
        nodes: [
          expect.objectContaining({
            $ref: mockTask1Uid,
            title: "Implement user authentication system",
          }),
        ],
      });
    });

    it("applies all query fields to new dataview items with AND separator", async () => {
      const markdownWithMultipleFields = `# Document with Multi-Field Query

:::dataview{query="type=Idea AND ideaStatus=exploring" template="{{title}}"}
- Implement real-time collaboration
- Add something extra
:::
`;

      const parseResult = throwIfError(
        await parseFile(markdownWithMultipleFields, filePath, config, kg),
      );

      const diffResult = throwIfError(
        diffNodeTrees(parseResult.file, parseResult.kg),
      );

      const newIdeas = diffResult.filter(
        (change) => !("$ref" in change) && change.type === "Idea",
      );
      expect(newIdeas.length).toBe(2);
      expect(newIdeas[0]).toEqual(
        expect.objectContaining({
          type: "Idea",
          ideaStatus: "exploring",
          title: "Implement real-time collaboration",
        }),
      );
      expect(newIdeas[1]).toEqual(
        expect.objectContaining({
          type: "Idea",
          ideaStatus: "exploring",
          title: "Add something extra",
        }),
      );
    });
  });
});
