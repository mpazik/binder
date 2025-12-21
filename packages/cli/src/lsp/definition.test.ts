import { beforeEach, describe, expect, it } from "bun:test";
import { TextDocument } from "vscode-languageserver-textdocument";
import "@binder/utils/tests";
import { throwIfError } from "@binder/utils";
import { changesetInputForNewEntity } from "@binder/db";
import {
  mockProjectNode,
  mockTransactionInit,
  mockTransactionInitInput,
} from "@binder/db/mocks";
import type { RuntimeContextWithDb } from "../runtime.ts";
import { createMockRuntimeContextWithDb, mockLog } from "../runtime.mock.ts";
import { mockNavigationConfigInput } from "../document/navigation.mock.ts";
import { createDocumentCache, type DocumentCache } from "./document-cache.ts";
import { handleDefinition } from "./definition.ts";

type LspDocuments = {
  get: (uri: string) => TextDocument | undefined;
};

describe("definition", () => {
  let runtime: RuntimeContextWithDb;
  let documentCache: DocumentCache;

  const createDocument = (uri: string, content: string): TextDocument =>
    TextDocument.create(uri, "yaml", 1, content);

  const createLspDocuments = (docs: TextDocument[]): LspDocuments => ({
    get: (uri: string) => docs.find((d) => d.uri === uri),
  });

  beforeEach(async () => {
    runtime = await createMockRuntimeContextWithDb();
    documentCache = createDocumentCache(mockLog);
    throwIfError(await runtime.kg.apply(mockTransactionInit));
  });

  it("returns null when cursor is not on a relation field value", async () => {
    const doc = createDocument(
      `file://${runtime.config.paths.docs}/tasks/my-task.yaml`,
      "type: Task\ntitle: My Task",
    );

    const result = await handleDefinition(
      { textDocument: { uri: doc.uri }, position: { line: 1, character: 3 } },
      createLspDocuments([doc]),
      documentCache,
      runtime,
      mockLog,
    );

    expect(result).toBeNull();
  });

  it("returns null when field is not a relation type", async () => {
    const doc = createDocument(
      `file://${runtime.config.paths.docs}/tasks/my-task.yaml`,
      "type: Task\ntitle: My Task\ndescription: Some description",
    );

    const result = await handleDefinition(
      { textDocument: { uri: doc.uri }, position: { line: 2, character: 15 } },
      createLspDocuments([doc]),
      documentCache,
      runtime,
      mockLog,
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

    const doc = createDocument(
      `file://${runtime.config.paths.docs}/tasks/my-task.yaml`,
      `type: Task\ntitle: My Task\nproject: ${mockProjectNode.key}`,
    );

    const result = await handleDefinition(
      { textDocument: { uri: doc.uri }, position: { line: 2, character: 12 } },
      createLspDocuments([doc]),
      documentCache,
      runtime,
      mockLog,
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
    const doc = createDocument(
      `file://${runtime.config.paths.docs}/tasks/my-task.yaml`,
      "type: Task\ntitle: My Task\nproject: non-existent-project",
    );

    const result = await handleDefinition(
      { textDocument: { uri: doc.uri }, position: { line: 2, character: 12 } },
      createLspDocuments([doc]),
      documentCache,
      runtime,
      mockLog,
    );

    expect(result).toBeNull();
  });
});
