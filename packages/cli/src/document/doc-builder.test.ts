import { join } from "path";
import { fileURLToPath } from "url";
import { beforeEach, describe, expect, it } from "bun:test";
import { throwIfError } from "@binder/utils";
import {
  changesetInputForNewEntity,
  type KnowledgeGraph,
  type NodeRef,
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
import { mockDocumentTransactionInput } from "./document.mock.ts";

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

    const ast = throwIfError(await buildAstDoc(kg, "simple.md" as NodeRef));
    const expected = await Bun.file(
      join(__dirname, "../../test/data/ast.json"),
    ).json();
    expect(ast).toEqual(expected);
  });
});
