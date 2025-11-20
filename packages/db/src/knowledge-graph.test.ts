import { beforeEach, describe, expect, it } from "bun:test";
import { okVoid, throwIfError } from "@binder/utils";
import "@binder/utils/tests";
import { getTestDatabase } from "./db.mock";
import { openKnowledgeGraph } from "./knowledge-graph.ts";
import type { Database } from "./db.ts";
import { createEntity, fetchEntity } from "./entity-store.ts";
import {
  mockProjectNode,
  mockTask1Key,
  mockTask1Node,
  mockTask1Uid,
  mockTask2Node,
  mockTask3Node,
  mockTaskNode1Updated,
  NONEXISTENT_NODE_UID,
} from "./model/node.mock.ts";
import {
  mockTransactionInit,
  mockTransactionInitInput,
  mockTransactionInputUpdate,
  mockTransactionUpdate,
} from "./model/transaction.mock.ts";
import { mockTaskType, mockTaskTypeKey } from "./model/config.mock.ts";
import {
  configSchema,
  type ConfigUid,
  GENESIS_VERSION,
  type Transaction,
  versionFromTransaction,
} from "./model";
import { applyAndSaveTransaction } from "./transaction-processor.ts";
import { mockNodeSchema } from "./model/schema.mock.ts";

describe("knowledge-graph-setup", () => {
  let db: Database;
  let kg: ReturnType<typeof openKnowledgeGraph>;

  beforeEach(() => {
    db = getTestDatabase();
    kg = openKnowledgeGraph(db);
  });

  it("processes transaction input and fetches task nodes", async () => {
    const transaction = throwIfError(await kg.update(mockTransactionInitInput));

    expect(transaction.nodes).toBeDefined();

    const taskUids = Object.keys(transaction.nodes);
    expect(taskUids.length).toBe(3);

    const taskResults = throwIfError(
      await kg.search({ filters: { type: "Task" } }),
    );
    expect(taskResults.items.length).toBe(2);
    expect(taskResults.items[0]!.type).toBe("Task");
    expect(taskResults.items[1]!.type).toBe("Task");
  });
});

describe("knowledge graph", () => {
  let db: Database;
  let kg: ReturnType<typeof openKnowledgeGraph>;

  beforeEach(async () => {
    db = getTestDatabase();
    kg = openKnowledgeGraph(db);
  });

  describe("with data", () => {
    beforeEach(async () => {
      await db.transaction(async (tx) => {
        throwIfError(await applyAndSaveTransaction(tx, mockTransactionInit));
      });
    });

    describe("fetchNode", () => {
      beforeEach(async () => {
        await db.transaction(async (tx) => {
          await createEntity(tx, "node", mockProjectNode);
          await createEntity(tx, "node", mockTask2Node);
          await createEntity(tx, "node", mockTask3Node);
        });
      });

      it("fetches node by id", async () => {
        const result = throwIfError(await kg.fetchNode(mockTask1Node.id));

        expect(result).toEqual(mockTask1Node);
      });

      it("fetches node by uid", async () => {
        const result = throwIfError(await kg.fetchNode(mockTask1Uid));

        expect(result).toEqual(mockTask1Node);
      });

      it("fetches node by key", async () => {
        const result = throwIfError(await kg.fetchNode(mockTask1Key));

        expect(result).toEqual(mockTask1Node);
      });

      it("returns error when node doesn't exist", async () => {
        const result = await kg.fetchNode(NONEXISTENT_NODE_UID);

        expect(result).toBeErr();
      });

      it("fetches node with relationship includes", async () => {
        const result = throwIfError(
          await kg.fetchNode(mockTask2Node.uid, { uid: true, project: true }),
        );

        expect(result.uid).toBe(mockTask2Node.uid);
        expect(result.project).toEqual(
          expect.objectContaining({
            uid: mockProjectNode.uid,
            title: mockProjectNode.title,
          }),
        );
      });

      it("applies field selection with includes", async () => {
        const result = throwIfError(
          await kg.fetchNode(mockTask2Node.uid, {
            title: true,
            project: { includes: { title: true } },
          }),
        );

        expect(result).toEqual({
          title: mockTask2Node.title,
          project: { title: mockProjectNode.title },
        });
      });
    });

    describe("fetchConfig", () => {
      it("fetches config by uid", async () => {
        const result = throwIfError(await kg.fetchConfig(mockTaskType.uid));

        expect(result).toEqual(mockTaskType);
      });

      it("fetches config by key", async () => {
        const result = throwIfError(
          await kg.fetchConfig(mockTaskTypeKey as any),
        );

        expect(result).toEqual(mockTaskType);
      });

      it("returns error when config doesn't exist", async () => {
        const result = await kg.fetchConfig(NONEXISTENT_NODE_UID as ConfigUid);

        expect(result).toBeErr();
      });
    });

    describe("update", () => {
      it("processes and applies transaction", async () => {
        let savedTransaction: Transaction | undefined;
        const kgWithCallback = openKnowledgeGraph(db, {
          beforeCommit: async (tx: Transaction) => {
            savedTransaction = tx;
            return okVoid;
          },
        });

        const returnedTransaction = throwIfError(
          await kgWithCallback.update(mockTransactionInputUpdate),
        );
        expect(returnedTransaction).toEqual(mockTransactionUpdate);

        const updatedNode = await db.transaction(async (tx) =>
          throwIfError(await fetchEntity(tx, "node", mockTask1Uid)),
        );

        expect(updatedNode).toEqual(mockTaskNode1Updated);
        expect(savedTransaction).toEqual(mockTransactionUpdate);
      });
    });

    describe("search", () => {
      beforeEach(async () => {
        await db.transaction(async (tx) => {
          const { mockTask2Node, mockTask3Node, mockProjectNode } =
            await import("./model/node.mock.ts");
          await createEntity(tx, "node", mockProjectNode);
          await createEntity(tx, "node", mockTask2Node);
          await createEntity(tx, "node", mockTask3Node);
        });
      });

      it("returns all nodes without filters", async () => {
        const result = throwIfError(await kg.search({}));

        expect(result.items.length).toBe(4);
        expect(result.pagination.hasNext).toBe(false);
      });

      it("filters by type", async () => {
        const result = throwIfError(
          await kg.search({
            filters: { type: "Task" },
          }),
        );

        expect(result.items).toEqual([
          mockTask1Node,
          mockTask2Node,
          mockTask3Node,
        ]);
      });

      it("respects pagination limit", async () => {
        const result = throwIfError(
          await kg.search({
            pagination: { limit: 2 },
          }),
        );

        expect(result.items.length).toBe(2);
        expect(result.pagination.hasNext).toBe(true);
      });

      it("rejects filters with invalid field names", async () => {
        const result = await kg.search({
          filters: { InvalidField: "value" },
        });
        expect(result).toBeErrWithKey("invalid_filter_field");
      });

      it("searches config namespace when specified", async () => {
        const result = throwIfError(
          await kg.search(
            {
              filters: { type: "Type" },
            },
            "config",
          ),
        );

        const types = Object.keys(mockNodeSchema.types);
        expect(result.items.map((it) => it.key)).toEqual(types);
      });

      it("resolves direct relationship with includes", async () => {
        const result = throwIfError(
          await kg.search({
            filters: { type: "Task", key: mockTask2Node.key },
            includes: { project: true },
          }),
        );

        expect(result.items.length).toBe(1);
        const task = result.items[0]!;
        expect(task.project).toEqual(
          expect.objectContaining({
            uid: mockProjectNode.uid,
            title: mockProjectNode.title,
          }),
        );
      });

      it("resolves inverse relationship with includes", async () => {
        const { mockTasksFieldKey } = await import("./model/config.mock.ts");
        const result = throwIfError(
          await kg.search({
            filters: { type: "Project" },
            includes: { [mockTasksFieldKey]: true },
          }),
        );

        expect(result.items.length).toBe(1);
        const project = result.items[0]!;
        expect(Array.isArray(project[mockTasksFieldKey])).toBe(true);
        expect((project[mockTasksFieldKey] as any[]).length).toBe(2);
      });

      it("applies field selection with includes", async () => {
        const result = throwIfError(
          await kg.search({
            filters: { type: "Task", key: mockTask2Node.key },
            includes: {
              title: true,
              project: { includes: { uid: true, title: true } },
            },
          }),
        );

        expect(result.items.length).toBe(1);
        const task = result.items[0]!;
        expect(task.title).toBe(mockTask2Node.title);
        expect(task.description).toBeUndefined();
        expect(task.project).toEqual(
          expect.objectContaining({
            uid: mockProjectNode.uid,
            title: mockProjectNode.title,
          }),
        );
        expect((task.project as any).description).toBeUndefined();
      });
    });

    describe("rollback", () => {
      it("reverts changes", async () => {
        throwIfError(await kg.update(mockTransactionInputUpdate));
        const updatedNode = throwIfError(await kg.fetchNode(mockTask1Uid));
        expect(updatedNode).toEqual(mockTaskNode1Updated);

        throwIfError(await kg.rollback(1));

        const rolledBackNode = throwIfError(await kg.fetchNode(mockTask1Uid));
        expect(rolledBackNode).toEqual(mockTask1Node);
      });

      it("reverts changes with explicit version", async () => {
        throwIfError(await kg.update(mockTransactionInputUpdate));
        const version = throwIfError(await kg.version());
        const updatedNode = throwIfError(await kg.fetchNode(mockTask1Uid));
        expect(updatedNode).toEqual(mockTaskNode1Updated);

        throwIfError(await kg.rollback(1, version.id));

        const rolledBackNode = throwIfError(await kg.fetchNode(mockTask1Uid));
        expect(rolledBackNode).toEqual(mockTask1Node);
      });

      it("returns error when version mismatches", async () => {
        throwIfError(await kg.update(mockTransactionInputUpdate));

        const result = await kg.rollback(1, mockTransactionInit.id);

        expect(result).toBeErr();
        expect(result).toEqual(
          expect.objectContaining({
            error: expect.objectContaining({
              key: "version-mismatch",
            }),
          }),
        );
      });
    });
  });

  describe("version", () => {
    it("returns correct version for empty knowledge graph", async () => {
      const result = throwIfError(await kg.version());

      expect(result).toEqual(GENESIS_VERSION);
    });

    it("returns version before and after update", async () => {
      throwIfError(await kg.apply(mockTransactionInit));

      const result = throwIfError(await kg.version());
      expect(result).toEqual(versionFromTransaction(mockTransactionInit));

      throwIfError(await kg.update(mockTransactionInputUpdate));

      const updatedResult = throwIfError(await kg.version());
      expect(updatedResult).toEqual(
        versionFromTransaction(mockTransactionUpdate),
      );
    });
  });
});
