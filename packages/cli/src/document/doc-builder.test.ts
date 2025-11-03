import { join } from "path";
import { fileURLToPath } from "url";
import { beforeEach, describe, expect, it } from "bun:test";
import { throwIfError } from "@binder/utils";
import "@binder/utils/tests";
import {
  changesetInputForNewEntity,
  type Fieldset,
  type KnowledgeGraph,
  openKnowledgeGraph,
} from "@binder/db";
import {
  getTestDatabase,
  mockTask1Node,
  mockTask2Node,
} from "@binder/db/mocks";
import {
  buildAstDoc,
  deconstructAstDocument,
  fetchDocumentNodes,
} from "./doc-builder.ts";
import { documentSchemaTransactionInput } from "./document-schema.ts";
import {
  mockCoreTransactionInputForDocs,
  mockDataviewUid,
  mockDocumentTransactionInput,
  mockDocumentUid,
} from "./document.mock.ts";
import { parseMarkdown } from "./markdown.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const findNestedNode = <T = any>(
  root: any,
  childrenKey: string,
  predicate: (node: any) => boolean,
): T | undefined => {
  if (predicate(root)) return root;

  const children = root[childrenKey];
  if (!Array.isArray(children)) return undefined;

  for (const child of children) {
    const found = findNestedNode<T>(child, childrenKey, predicate);
    if (found) return found;
  }

  return undefined;
};

describe("DocumentBuilder", () => {
  describe("fetchDocumentNodes", () => {
    let kg: KnowledgeGraph;
    beforeEach(async () => {
      const db = getTestDatabase();
      kg = openKnowledgeGraph(db);
      throwIfError(await kg.update(documentSchemaTransactionInput));
      throwIfError(await kg.update(mockCoreTransactionInputForDocs));
      throwIfError(await kg.update(mockDocumentTransactionInput));
    });

    it("returns nested document structure", async () => {
      const document = throwIfError(
        await fetchDocumentNodes(kg, mockDocumentUid),
      );

      expect(document).toMatchObject({
        type: "Document",
        uid: mockDocumentUid,
        blockContent: expect.arrayContaining([
          expect.anything(),
          expect.anything(),
          expect.anything(),
        ]),
      });
    });

    it("includes data field in Dataview blocks with query results", async () => {
      const document = throwIfError(
        await fetchDocumentNodes(kg, mockDocumentUid),
      );

      const dataviewBlock = findNestedNode(
        document,
        "blockContent",
        (node: any) => node.uid === mockDataviewUid,
      );

      expect(dataviewBlock).toMatchObject({
        type: "Dataview",
        query: { filters: { type: "Task" } },
        data: [mockTask1Node, mockTask2Node],
      });
    });

    it("returns error when node is not a Document", async () => {
      const result = await fetchDocumentNodes(kg, mockTask1Node.uid);

      expect(result).toBeErrWithKey("not_a_document");
    });
  });

  describe("buildAstDoc", () => {
    let kg: KnowledgeGraph;
    beforeEach(async () => {
      const db = getTestDatabase();
      kg = openKnowledgeGraph(db);
      throwIfError(await kg.update(documentSchemaTransactionInput));
      throwIfError(
        await kg.update({
          ...mockCoreTransactionInputForDocs,
          nodes: [
            changesetInputForNewEntity(mockTask1Node),
            changesetInputForNewEntity(mockTask2Node),
          ],
        }),
      );
    });

    it("renders document AST", async () => {
      throwIfError(await kg.update(mockDocumentTransactionInput));

      const ast = throwIfError(await buildAstDoc(kg, mockDocumentUid));
      const expected = await Bun.file(
        join(__dirname, "../../test/data/ast.json"),
      ).json();
      expect(ast).toEqual(expected);
    });

    it("renders dataview with custom template", async () => {
      const customDocTx = {
        ...mockDocumentTransactionInput,
        nodes: mockDocumentTransactionInput.nodes?.map((node: any) =>
          node.type === "Dataview"
            ? { ...node, template: "**{{title}}** - {{description}}" }
            : node,
        ),
      };
      throwIfError(await kg.update(customDocTx));

      const ast = throwIfError(await buildAstDoc(kg, mockDocumentUid));
      const dataviewNode = ast.children.find(
        (node: any) =>
          node.type === "containerDirective" && node.name === "dataview",
      ) as any;

      expect(dataviewNode).toBeDefined();
      expect(dataviewNode.children).toEqual([
        {
          type: "list",
          ordered: false,
          start: null,
          spread: false,
          children: [
            {
              type: "listItem",
              spread: false,
              checked: null,
              children: [
                {
                  type: "paragraph",
                  children: [
                    {
                      type: "text",
                      value:
                        "**Implement user authentication** - Add login and registration functionality with JWT tokens",
                    },
                  ],
                },
              ],
            },
            {
              type: "listItem",
              spread: false,
              checked: null,
              children: [
                {
                  type: "paragraph",
                  children: [
                    {
                      type: "text",
                      value:
                        "**Implement schema generator** - Create a dynamic schema generator",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]);
    });
  });

  describe("deconstructAstDocument", () => {
    const check = (markdown: string, expected: Fieldset) => {
      const ast = throwIfError(parseMarkdown(markdown));
      const document = throwIfError(deconstructAstDocument(ast));
      expect(document).toEqual(expected);
    };

    it("deconstructs markdown to nested document structure", async () => {
      const mdPath = join(__dirname, "../../test/data/simple.md");
      const markdown = await Bun.file(mdPath).text();

      check(markdown, {
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
    });

    it("handles content before first heading", () => {
      check(
        `Introduction paragraph

# First Section
Section content`,
        {
          type: "Document",
          blockContent: [
            {
              type: "Paragraph",
              textContent: "Introduction paragraph",
            },
            {
              type: "Section",
              title: "First Section",
              blockContent: [
                {
                  type: "Paragraph",
                  textContent: "Section content",
                },
              ],
            },
          ],
        },
      );
    });

    it("handles empty markdown", () => {
      check("", {
        type: "Document",
        blockContent: [],
      });
    });

    it("handles markdown with only paragraphs (no headings)", () => {
      check(
        `First paragraph

Second paragraph`,
        {
          type: "Document",
          blockContent: [
            {
              type: "Paragraph",
              textContent: "First paragraph",
            },
            {
              type: "Paragraph",
              textContent: "Second paragraph",
            },
          ],
        },
      );
    });

    it("handles lists", () => {
      check(
        `# List Section
- First item
- Second item`,
        {
          type: "Document",
          blockContent: [
            {
              type: "Section",
              title: "List Section",
              blockContent: [
                {
                  type: "List",
                  blockContent: [
                    { type: "ListItem", textContent: "First item" },
                    { type: "ListItem", textContent: "Second item" },
                  ],
                },
              ],
            },
          ],
        },
      );
    });

    it("handles dataview blocks", () => {
      check(
        `# Query Section
:::dataview{query="type=Task AND status=active"}
Some content
:::`,
        {
          type: "Document",
          blockContent: [
            {
              type: "Section",
              title: "Query Section",
              blockContent: [
                {
                  type: "Dataview",
                  query: { filters: { type: "Task", status: "active" } },
                },
              ],
            },
          ],
        },
      );
    });

    it("ignores non-dataview directives", () => {
      check(
        `# Section
:::other{attr="value"}
Content
:::

After directive`,
        {
          type: "Document",
          blockContent: [
            {
              type: "Section",
              title: "Section",
              blockContent: [
                {
                  type: "Paragraph",
                  textContent: "After directive",
                },
              ],
            },
          ],
        },
      );
    });
  });
});
