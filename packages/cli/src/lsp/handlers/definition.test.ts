import { beforeEach, describe, expect, it } from "bun:test";
import { TextDocument } from "vscode-languageserver-textdocument";
import "@binder/utils/tests";
import { throwIfError } from "@binder/utils";
import { mockProjectNode, mockTransactionInit } from "@binder/db/mocks";
import type { RuntimeContextWithDb } from "../../runtime.ts";
import { createMockRuntimeContextWithDb } from "../../runtime.mock.ts";
import { mockNavigationConfigInput } from "../../document/navigation.mock.ts";
import {
  createDocumentCache,
  type DocumentContext,
  getDocumentContext,
} from "../document-context.ts";
import { createEntityContextCache } from "../entity-context.ts";
import { handleDefinition } from "./definition.ts";

describe("definition", () => {
  let runtime: RuntimeContextWithDb;
  let documentCache: ReturnType<typeof createDocumentCache>;
  let entityContextCache: ReturnType<typeof createEntityContextCache>;

  const createContext = async (
    relativePath: string,
    content: string,
  ): Promise<{ document: TextDocument; context: DocumentContext }> => {
    const uri = `file://${runtime.config.paths.docs}/${relativePath}`;
    return {
      document: TextDocument.create(uri, "yaml", 1, content),
      context: throwIfError(
        await getDocumentContext(
          TextDocument.create(uri, "yaml", 1, content),
          documentCache,
          entityContextCache,
          runtime,
        ),
      ),
    };
  };

  beforeEach(async () => {
    runtime = await createMockRuntimeContextWithDb();
    throwIfError(await runtime.kg.apply(mockTransactionInit));
    throwIfError(
      await runtime.kg.update({
        author: "test",
        configurations: mockNavigationConfigInput,
      }),
    );
    documentCache = createDocumentCache(runtime.log);
    entityContextCache = createEntityContextCache(runtime.log, runtime.kg);
  });

  it("returns null when cursor is not on a relation field value", async () => {
    const { document, context } = await createContext(
      "tasks/my-task.yaml",
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
    const { document, context } = await createContext(
      "tasks/my-task.yaml",
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
    const { document, context } = await createContext(
      "tasks/my-task.yaml",
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
    const { document, context } = await createContext(
      "tasks/my-task.yaml",
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
