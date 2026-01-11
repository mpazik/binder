import { beforeEach, describe, expect, it } from "bun:test";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { CompletionItem } from "vscode-languageserver/node";
import "@binder/utils/tests";
import { assertFailed, throwIfError } from "@binder/utils";
import {
  mockAssignedToFieldKey,
  mockProjectKey,
  mockProjectTypeKey,
  mockStatusFieldKey,
  mockTransactionInit,
} from "@binder/db/mocks";
import { BINDER_DIR } from "../../config.ts";
import type { RuntimeContextWithDb } from "../../runtime.ts";
import { createMockRuntimeContextWithDb } from "../../runtime.mock.ts";
import { mockNavigationConfigInput } from "../../document/navigation.mock.ts";
import {
  createDocumentCache,
  getDocumentContext,
} from "../document-context.ts";
import { createEntityContextCache } from "../entity-context.ts";
import { handleCompletion } from "./completion.ts";

const CURSOR = "█";

const parseCursor = (
  contentWithCursor: string,
): { content: string; line: number; character: number } => {
  const cursorIndex = contentWithCursor.indexOf(CURSOR);
  if (cursorIndex === -1) {
    assertFailed(`Cursor marker "${CURSOR}" not found in content`);
  }

  const content =
    contentWithCursor.slice(0, cursorIndex) +
    contentWithCursor.slice(cursorIndex + CURSOR.length);

  const beforeCursor = contentWithCursor.slice(0, cursorIndex);
  const lines = beforeCursor.split("\n");
  const line = lines.length - 1;
  const character = lines[line].length;

  return { content, line, character };
};

describe("completion", () => {
  let runtime: RuntimeContextWithDb;
  let documentCache: ReturnType<typeof createDocumentCache>;
  let entityContextCache: ReturnType<typeof createEntityContextCache>;

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

  const complete = async (
    relativePath: string,
    contentWithCursor: string,
  ): Promise<CompletionItem[]> => {
    const { content, line, character } = parseCursor(contentWithCursor);
    const isConfig = relativePath.startsWith(BINDER_DIR);
    const basePath = isConfig
      ? runtime.config.paths.root
      : runtime.config.paths.docs;
    const filePath = `${basePath}/${relativePath}`;
    const uri = `file://${filePath}`;

    const document = TextDocument.create(uri, "yaml", 1, content);
    const context = throwIfError(
      await getDocumentContext(
        document,
        documentCache,
        entityContextCache,
        runtime,
      ),
    );

    return handleCompletion(
      {
        textDocument: { uri },
        position: { line, character },
      },
      { document, context, runtime },
    );
  };

  const check = async (
    relativePath: string,
    contentWithCursor: string,
    included: string[],
    excluded: string[] = [],
  ) => {
    const result = await complete(relativePath, contentWithCursor);
    for (const key of included) {
      expect(result.some((item) => item.insertText === key)).toBe(true);
    }
    for (const key of excluded) {
      expect(result.some((item) => item.insertText === key)).toBe(false);
    }
  };

  describe("relation field completions", () => {
    it("provides completions for relation field value", async () => {
      const result = await complete(
        "tasks/my-task.yaml",
        `type: Task
title: My Task
project: █`,
      );

      expect(result).toEqual([
        expect.objectContaining({
          insertText: mockProjectKey,
          detail: mockProjectTypeKey,
        }),
      ]);
    });

    it("provides completions for empty relation field", async () => {
      await check(
        "tasks/my-task.yaml",
        `type: Task
title: My Task
project: █`,
        [mockProjectKey],
      );
    });

    it("provides completions for relation field with partial input", async () => {
      await check(
        "tasks/my-task.yaml",
        `type: Task
title: My Task
project: pro█`,
        [mockProjectKey],
      );
    });

    it("returns empty for non-relation field", async () => {
      const result = await complete(
        "tasks/my-task.yaml",
        `type: Task
title: █`,
      );

      expect(result).toEqual([]);
    });
  });

  describe("multi-relation field completions", () => {
    it("provides Field entity completions for fields list item", async () => {
      await check(
        `${BINDER_DIR}/types.yaml`,
        `items:
  - key: Task
    name: Task
    fields:
      - █`,
        [mockStatusFieldKey, mockAssignedToFieldKey],
      );
    });

    it("filters out existing items from completions", async () => {
      await check(
        `${BINDER_DIR}/types.yaml`,
        `items:
  - key: Task
    name: Task
    fields:
      - status
      - █`,
        [mockAssignedToFieldKey],
        [mockStatusFieldKey],
      );
    });

    it("filters out existing items in ObjTuple format", async () => {
      await check(
        `${BINDER_DIR}/types.yaml`,
        `items:
  - key: Task
    name: Task
    fields:
      - status: { required: true }
      - █`,
        [mockAssignedToFieldKey],
        [mockStatusFieldKey],
      );
    });

    it("returns empty for non-relation list fields", async () => {
      const result = await complete(
        "tasks/my-task.yaml",
        `type: Task
title: My Task
tags:
  - █`,
      );

      expect(result).toEqual([]);
    });
  });
});
