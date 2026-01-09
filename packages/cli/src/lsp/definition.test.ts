import { beforeEach, describe, expect, it } from "bun:test";
import { TextDocument } from "vscode-languageserver-textdocument";
import "@binder/utils/tests";
import { throwIfError } from "@binder/utils";
import { mockProjectNode, mockTransactionInit } from "@binder/db/mocks";
import type { EntitySchema, NodeDataType } from "@binder/db";
import type { RuntimeContextWithDb } from "../runtime.ts";
import { createMockRuntimeContextWithDb } from "../runtime.mock.ts";
import { mockNavigationConfigInput } from "../document/navigation.mock.ts";
import { parseYamlDocument } from "../document/yaml-cst.ts";
import { handleDefinition } from "./definition.ts";
import type { DocumentContext } from "./lsp-utils.ts";

describe("definition", () => {
  let runtime: RuntimeContextWithDb;
  let schema: EntitySchema<NodeDataType>;

  const createDocumentContext = (
    uri: string,
    content: string,
  ): { document: TextDocument; context: DocumentContext } => {
    const document = TextDocument.create(uri, "yaml", 1, content);
    const parsed = parseYamlDocument(content);

    return {
      document,
      context: {
        document,
        parsed,
        uri,
        namespace: "node",
        schema,
        navigationItem: {
          path: "tasks/",
          query: { filters: { type: "Task" } },
        },
        typeDef: schema.types.Task,
        entityMappings: { kind: "single", mapping: { status: "new" } },
      },
    };
  };

  beforeEach(async () => {
    runtime = await createMockRuntimeContextWithDb();
    throwIfError(await runtime.kg.apply(mockTransactionInit));
    schema = throwIfError(await runtime.kg.getSchema("node"));
  });

  it("returns null when cursor is not on a relation field value", async () => {
    const { document, context } = createDocumentContext(
      `file://${runtime.config.paths.docs}/tasks/my-task.yaml`,
      "type: Task\ntitle: My Task",
    );

    const result = await handleDefinition(
      {
        textDocument: { uri: document.uri },
        position: { line: 1, character: 3 },
      },
      { document, context, runtime },
    );

    expect(result).toBeNull();
  });

  it("returns null when field is not a relation type", async () => {
    const { document, context } = createDocumentContext(
      `file://${runtime.config.paths.docs}/tasks/my-task.yaml`,
      "type: Task\ntitle: My Task\ndescription: Some description",
    );

    const result = await handleDefinition(
      {
        textDocument: { uri: document.uri },
        position: { line: 2, character: 15 },
      },
      { document, context, runtime },
    );

    expect(result).toBeNull();
  });

  it("returns location for relation field with key reference", async () => {
    throwIfError(
      await runtime.kg.update({
        author: "test",
        configurations: mockNavigationConfigInput,
      }),
    );

    const { document, context } = createDocumentContext(
      `file://${runtime.config.paths.docs}/tasks/my-task.yaml`,
      `type: Task\ntitle: My Task\nproject: ${mockProjectNode.key}`,
    );

    const result = await handleDefinition(
      {
        textDocument: { uri: document.uri },
        position: { line: 2, character: 12 },
      },
      { document, context, runtime },
    );

    expect(result).toEqual({
      uri: `file://${runtime.config.paths.docs}/projects/${mockProjectNode.title}/`,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      },
    });
  });

  it("returns null when referenced entity does not exist", async () => {
    const { document, context } = createDocumentContext(
      `file://${runtime.config.paths.docs}/tasks/my-task.yaml`,
      "type: Task\ntitle: My Task\nproject: non-existent-project",
    );

    const result = await handleDefinition(
      {
        textDocument: { uri: document.uri },
        position: { line: 2, character: 12 },
      },
      { document, context, runtime },
    );

    expect(result).toBeNull();
  });
});
