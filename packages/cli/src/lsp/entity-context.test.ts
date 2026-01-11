import { beforeEach, describe, expect, it } from "bun:test";
import { pick, throwIfError } from "@binder/utils";
import "@binder/utils/tests";
import type { KnowledgeGraph } from "@binder/db";
import {
  mockNodeSchema,
  mockProjectNode,
  mockProjectTypeKey,
  mockTask1Node,
  mockTask1Uid,
  mockTask2Node,
  mockTask2Uid,
  mockTaskTypeKey,
  mockTransactionInitInput,
} from "@binder/db/mocks";
import { createMockRuntimeContextWithDb } from "../runtime.mock.ts";
import type { RuntimeContextWithDb } from "../runtime.ts";
import { mockDocumentTransactionInput } from "../document/document.mock.ts";
import { type NavigationItem } from "../document/navigation.ts";
import { mockTemplates } from "../document/template.mock.ts";
import { renderYamlEntity, renderYamlList } from "../document/yaml.ts";
import { extract } from "../document/extraction.ts";
import {
  computeEntityMappings,
  type EntityMappings,
} from "./entity-mapping.ts";
import { fetchEntityContext } from "./entity-context.ts";

describe("entity-context", () => {
  const schema = mockNodeSchema;
  let ctx: RuntimeContextWithDb;
  let kg: KnowledgeGraph;

  beforeEach(async () => {
    ctx = await createMockRuntimeContextWithDb();
    kg = ctx.kg;
    throwIfError(await kg.update(mockTransactionInitInput));
    throwIfError(await kg.update(mockDocumentTransactionInput));
  });

  const check = async (
    navItem: NavigationItem,
    content: string,
    filePath: string,
    expected: EntityMappings,
  ) => {
    const entityContext = throwIfError(
      await fetchEntityContext(kg, schema, navItem, filePath),
    );

    const extracted = throwIfError(
      extract(schema, navItem, content, filePath, mockTemplates),
    );

    const mappings = computeEntityMappings(schema, extracted, entityContext);
    expect(mappings).toEqual(expected);
  };

  describe("single entity (yaml)", () => {
    const navItem: NavigationItem = {
      path: "tasks/{key}.yaml",
      includes: { title: true, status: true },
    };

    it("resolves matched entity by path fields", async () => {
      const content = renderYamlEntity(
        pick(mockTask1Node, ["title", "status"]),
      );
      await check(navItem, content, `tasks/${mockTask1Node.key}.yaml`, {
        kind: "single",
        mapping: {
          status: "matched",
          uid: mockTask1Uid,
          type: mockTaskTypeKey,
        },
      });
    });

    // TODO: Add support for recognizing entities by uid in content when path doesn't match.
    // Currently fetchEntityContext only searches by path fields, so if a document has a uid
    // that exists in DB but the file path doesn't match, we won't find it.
    it.skip("resolves matched entity by uid in content", async () => {
      const content = renderYamlEntity({
        ...pick(mockTask1Node, ["uid"]),
        title: "Different Title",
        status: "different",
      });
      await check(navItem, content, "tasks/nonexistent-key.yaml", {
        kind: "single",
        mapping: {
          status: "matched",
          uid: mockTask1Uid,
          type: mockTaskTypeKey,
        },
      });
    });

    it("resolves new entity when not in database", async () => {
      const content = renderYamlEntity({
        ...pick(mockTask1Node, ["type"]),
        title: "New Task",
        status: "todo",
      });
      await check(navItem, content, "tasks/new-task.yaml", {
        kind: "single",
        mapping: {
          status: "new",
          type: mockTaskTypeKey,
        },
      });
    });
  });

  describe("list (yaml)", () => {
    const navItem: NavigationItem = {
      path: "all-tasks.yaml",
      query: { filters: { type: mockTaskTypeKey } },
    };

    it("resolves all matched entities by uid", async () => {
      const content = renderYamlList([
        pick(mockTask1Node, ["uid", "title"]),
        pick(mockTask2Node, ["uid", "title"]),
      ]);
      await check(navItem, content, "all-tasks.yaml", {
        kind: "list",
        mappings: [
          { status: "matched", uid: mockTask1Uid, type: mockTaskTypeKey },
          { status: "matched", uid: mockTask2Uid, type: mockTaskTypeKey },
        ],
      });
    });

    it("resolves entities without uid using similarity matching", async () => {
      const content = renderYamlList([
        pick(mockTask1Node, ["title"]),
        pick(mockTask2Node, ["title"]),
      ]);
      await check(navItem, content, "all-tasks.yaml", {
        kind: "list",
        mappings: [
          { status: "matched", uid: mockTask1Uid, type: mockTaskTypeKey },
          { status: "matched", uid: mockTask2Uid, type: mockTaskTypeKey },
        ],
      });
    });

    it("resolves new entities using type from filter", async () => {
      const content = renderYamlList([
        pick(mockTask1Node, ["title"]),
        { title: "New Task" },
        pick(mockTask2Node, ["title"]),
      ]);
      await check(navItem, content, "all-tasks.yaml", {
        kind: "list",
        mappings: [
          { status: "matched", uid: mockTask1Uid, type: mockTaskTypeKey },
          { status: "new", type: mockTaskTypeKey },
          { status: "matched", uid: mockTask2Uid, type: mockTaskTypeKey },
        ],
      });
    });

    it("use type that comes from the field if specified", async () => {
      const content = renderYamlList([
        pick(mockTask1Node, ["title"]),
        mockProjectNode,
        pick(mockTask2Node, ["title"]),
      ]);
      await check(navItem, content, "all-tasks.yaml", {
        kind: "list",
        mappings: [
          { status: "matched", uid: mockTask1Uid, type: mockTaskTypeKey },
          { status: "new", type: mockProjectTypeKey },
          { status: "matched", uid: mockTask2Uid, type: mockTaskTypeKey },
        ],
      });
    });
  });

  describe("document (markdown)", () => {
    const navItem: NavigationItem = {
      path: "tasks/{key}.md",
      template: "task-template",
    };

    const renderTaskMarkdown = (task: {
      title: string;
      status: string;
      description: string;
    }) => `# ${task.title}

**Status:** ${task.status}

## Description

${task.description}
`;

    it("resolves matched document entity", async () => {
      const content = renderTaskMarkdown(mockTask1Node);
      await check(navItem, content, `tasks/${mockTask1Node.key}.md`, {
        kind: "document",
        mapping: {
          status: "matched",
          uid: mockTask1Uid,
          type: mockTaskTypeKey,
        },
      });
    });

    it("resolves new document entity", async () => {
      const content = renderTaskMarkdown({
        title: "New Task",
        status: "todo",
        description: "A new task",
      });
      await check(navItem, content, "tasks/new-task.md", {
        kind: "document",
        mapping: {
          status: "new",
          type: undefined,
        },
      });
    });
  });

  describe("fetchEntityContext", () => {
    it("fetches existing entities for single nav item", async () => {
      const navItem: NavigationItem = {
        path: "tasks/{key}.yaml",
        includes: { title: true },
      };
      const result = throwIfError(
        await fetchEntityContext(
          kg,
          schema,
          navItem,
          `tasks/${mockTask1Node.key}.yaml`,
        ),
      );
      expect(result).toEqual({
        kind: "single",
        entities: [expect.objectContaining({ uid: mockTask1Uid })],
      });
    });

    it("fetches existing entities for list nav item", async () => {
      const navItem: NavigationItem = {
        path: "all-tasks.yaml",
        query: { filters: { type: mockTaskTypeKey } },
      };
      const result = throwIfError(
        await fetchEntityContext(kg, schema, navItem, "all-tasks.yaml"),
      );
      expect(result).toMatchObject({
        kind: "list",
        entities: [
          expect.objectContaining({ uid: mockTask1Uid }),
          expect.objectContaining({ uid: mockTask2Uid }),
        ],
      });
    });

    it("returns empty entities when no match found", async () => {
      const navItem: NavigationItem = {
        path: "tasks/{key}.yaml",
        includes: { title: true },
      };
      const result = throwIfError(
        await fetchEntityContext(kg, schema, navItem, "tasks/nonexistent.yaml"),
      );
      expect(result).toEqual({
        kind: "single",
        entities: [],
      });
    });
  });
});
