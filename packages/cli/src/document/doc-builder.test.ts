import { join } from "path";
import { fileURLToPath } from "url";
import { beforeEach, describe, expect, it } from "bun:test";
import { throwIfError } from "@binder/utils";
import {
  changesetInputForNewEntity,
  type KnowledgeGraph,
  openKnowledgeGraph,
} from "@binder/db";
import {
  getTestDatabase,
  mockTask1Node,
  mockTask2Node,
  mockTransactionInitInput,
} from "@binder/db/mocks";
import { buildAstDoc } from "./doc-builder.ts";
import { documentSchemaTransactionInput } from "./document-schema.ts";
import {
  mockDocumentTransactionInput,
  mockDocumentUid,
} from "./document.mock.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

describe("buildAstDoc", () => {
  let kg: KnowledgeGraph;

  beforeEach(() => {
    const db = getTestDatabase();
    kg = openKnowledgeGraph(db);
  });

  it("renders document AST", async () => {
    throwIfError(
      await kg.update({
        ...mockTransactionInitInput,
        nodes: [
          changesetInputForNewEntity(mockTask1Node),
          changesetInputForNewEntity(mockTask2Node),
        ],
      }),
    );
    throwIfError(await kg.update(documentSchemaTransactionInput));
    throwIfError(await kg.update(mockDocumentTransactionInput));

    const ast = throwIfError(await buildAstDoc(kg, mockDocumentUid));
    const expected = await Bun.file(
      join(__dirname, "../../test/data/ast.json"),
    ).json();
    expect(ast).toEqual(expected);
  });

  it("renders dataview with custom template", async () => {
    throwIfError(
      await kg.update({
        ...mockTransactionInitInput,
        nodes: [
          changesetInputForNewEntity(mockTask1Node),
          changesetInputForNewEntity(mockTask2Node),
        ],
      }),
    );
    throwIfError(await kg.update(documentSchemaTransactionInput));

    const customDocTx = {
      ...mockDocumentTransactionInput,
      nodes: mockDocumentTransactionInput.nodes.map((node: any) =>
        node.type === "Dataview"
          ? { ...node, template: "**{{title}}** - {{description}}" }
          : node,
      ),
    };
    throwIfError(await kg.update(customDocTx));

    const ast = throwIfError(await buildAstDoc(kg, mockDocumentUid));
    const dataviewNode = ast.children.find(
      (node: any) => node.type === "html" && node.value?.includes("dataview"),
    ) as any;

    expect(dataviewNode).toBeDefined();
    expect(dataviewNode?.value).toContain(
      "**Implement user authentication** - Add login and registration functionality with JWT tokens",
    );
    expect(dataviewNode?.value).toContain(
      "**Implement schema generator** - Create a dynamic schema generator",
    );
  });
});
