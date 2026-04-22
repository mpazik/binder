import { beforeEach, describe, expect, it } from "bun:test";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { CompletionItem } from "vscode-languageserver/node";
import "@binder/utils/tests";
import { assertFailed, throwIfError } from "@binder/utils";
import {
  mockAssignedToFieldKey,
  mockProjectKey,
  mockProjectTypeKey,
  mockStatusField,
  mockStatusFieldKey,
  mockTransactionInit,
} from "@binder/repo/mocks";
import { BINDER_DIR } from "../../config.ts";
import type { RuntimeContextWithDb } from "../../runtime.ts";
import { createMockRuntimeContextWithDb } from "../../runtime.mock.ts";
import { mockNavigationConfigInput } from "../../document/navigation.mock.ts";
import {
  createDocumentCache,
  getDocumentContext,
} from "../document-context.ts";
import { createEntityContextCache } from "../entity-context.ts";
import { getCompletionItems, handleCompletion } from "./completion.ts";

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
        configs: mockNavigationConfigInput,
      }),
    );
    documentCache = createDocumentCache(runtime.log);
    entityContextCache = createEntityContextCache(runtime);
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
    const getKey = (item: CompletionItem) => item.insertText ?? item.label;
    for (const key of included) {
      expect(result.some((item) => getKey(item) === key)).toBe(true);
    }
    for (const key of excluded) {
      expect(result.some((item) => getKey(item) === key)).toBe(false);
    }
  };

  const checkNoCompletions = async (
    relativePath: string,
    contentWithCursor: string,
  ) => {
    expect(await complete(relativePath, contentWithCursor)).toEqual([]);
  };

  const statusOptionKeys = [
    "pending",
    "active",
    "complete",
    "cancelled",
    "archived",
  ];

  const checkStatusOptions = async (contentWithCursor: string) => {
    await check("tasks/my-task.yaml", contentWithCursor, statusOptionKeys);
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

    it("provides relation completions for project field in frontmatter", async () => {
      await check(
        "md-tasks/my-task.md",
        `---
status: active
project: █
---

# My Task

## Description

Some description
`,
        [mockProjectKey],
      );
    });

    it("provides relation completions for list item relation field", async () => {
      await check(
        "all-tasks.yaml",
        `items:
  - key: task-1
    title: One
    project: █`,
        [mockProjectKey],
      );
    });

    it("returns empty for non-relation field", () =>
      checkNoCompletions(
        "tasks/my-task.yaml",
        `type: Task
title: █`,
      ));
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

    it("returns empty for non-relation list fields", () =>
      checkNoCompletions(
        "tasks/my-task.yaml",
        `type: Task
title: My Task
tags:
  - █`,
      ));
  });

  describe("field key completions", () => {
    it("provides completions for partial unknown key in yaml", async () => {
      await check(
        "tasks/my-task.yaml",
        `type: Task
title: My Task
sta█: active`,
        ["status"],
        ["project", "type", "title"],
      );
    });

    it("provides key completions on empty line in yaml map", async () => {
      await check(
        "tasks/my-task.yaml",
        `type: Task
title: My Task
█
status: active`,
        ["priority"],
        ["type", "title", "status"],
      );
    });

    it("provides completions for partial unknown key in frontmatter", async () => {
      await check(
        "md-tasks/my-task.md",
        `---
sta█: active
---

# My Task

## Description

Some description
`,
        ["status"],
        ["project"],
      );
    });

    it("provides key completions on empty line in frontmatter", async () => {
      await check(
        "md-tasks/my-task.md",
        `---
status: active
█
---

# My Task

## Description

Some description
`,
        ["project"],
        ["status"],
      );
    });

    it("uses current list item map for key completion scope", async () => {
      await check(
        "all-tasks.yaml",
        `items:
  - key: task-1
    title: One
    sta█: active`,
        ["status"],
        ["key", "title", "project"],
      );
    });

    it("provides key completions on empty line inside list item", async () => {
      await check(
        "all-tasks.yaml",
        `items:
  - key: task-1
    title: One
    █
    status: active`,
        ["priority"],
        ["key", "title", "status"],
      );
    });

    it("provides field key completions when yaml has a syntax error", async () => {
      // tags: [unclosed is an invalid YAML syntax error that makes YAML.parse throw.
      // Completions should still work for the cursor on the partial key above it.
      await check(
        "tasks/my-task.yaml",
        `type: Task
title: My Task
sta█
tags: [unclosed`,
        ["status"],
      );
    });
  });

  describe("option field completions", () => {
    it("provides all option completions regardless of partial input", async () => {
      await checkStatusOptions(`type: Task
title: My Task
status: c█`);
    });

    it("provides all option completions for empty value", async () => {
      await checkStatusOptions(`type: Task
title: My Task
status: █`);
    });

    it("provides option completions in frontmatter", async () => {
      await check(
        "md-tasks/my-task.md",
        `---
status: █
---

# My Task

## Description

Some description
`,
        statusOptionKeys,
      );
    });

    it("filters option completions by type-level only constraint", async () => {
      const items = await getCompletionItems(
        {
          kind: "field-value",
          cursorContext: {
            documentType: "yaml",
            type: "field-value",
            position: { line: 0, character: 0 },
            entity: { entityIndex: 0, mapping: { status: "new" } },
            fieldPath: ["status"],
            fieldDef: mockStatusField,
            fieldAttrs: { only: ["pending", "active"] },
          },
          context: { namespace: "record" } as never,
          excludeValues: [],
        },
        runtime.kg,
      );

      const values = items.map((item) => item.label);
      expect(values).toEqual(["pending", "active"]);
    });
  });
});
