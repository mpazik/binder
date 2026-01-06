import { beforeEach, describe, expect, it } from "bun:test";
import { okVoid, throwIfError } from "@binder/utils";
import "@binder/utils/tests";
import { getTestDatabase } from "./db.mock";
import openKnowledgeGraph from "./knowledge-graph.ts";
import type { Database } from "./db.ts";
import { createEntity, fetchEntity, updateEntity } from "./entity-store.ts";
import {
  mockProjectNode,
  mockTask1Key,
  mockTask1Node,
  mockTask1Uid,
  mockTask2Node,
  mockTask3Node,
  mockTaskNode1Updated,
  mockUserNode,
  NONEXISTENT_NODE_UID,
} from "./model/node.mock.ts";
import {
  mockTransactionInit,
  mockTransactionUpdate,
} from "./model/transaction.mock.ts";
import { mockTaskType, mockTaskTypeKey } from "./model/config.mock.ts";
import {
  type ConfigUid,
  coreFieldKeys,
  coreFields,
  GENESIS_VERSION,
  type Transaction,
  versionFromTransaction,
} from "./model";
import { applyAndSaveTransaction } from "./transaction-processor.ts";
import { mockNodeSchemaRaw } from "./model/schema.mock.ts";
import {
  mockTransactionInitInput,
  mockTransactionInputUpdate,
} from "./model/transaction-input.mock.ts";

describe("knowledge graph", () => {
  let db: Database;
  let kg: ReturnType<typeof openKnowledgeGraph>;

  beforeEach(async () => {
    db = getTestDatabase();
    kg = openKnowledgeGraph(db);
  });

  describe("setup", () => {
    it("processes transaction input and fetches task nodes", async () => {
      const transaction = throwIfError(
        await kg.update(mockTransactionInitInput),
      );

      expect(Object.keys(transaction.nodes)).toEqual([
        mockProjectNode.uid,
        mockTask1Node.uid,
        mockTask2Node.uid,
      ]);

      const taskResults = throwIfError(
        await kg.search({ filters: { type: "Task" } }),
      );
      expect(taskResults.items).toEqual([mockTask1Node, mockTask2Node]);
    });

    it("includes core fields in node schema", async () => {
      const schema = throwIfError(await kg.getNodeSchema());

      expect(Object.keys(schema.fields)).toEqual(coreFieldKeys);
    });
  });

  describe("with data", () => {
    beforeEach(async () => {
      await db.transaction(async (tx) => {
        throwIfError(await applyAndSaveTransaction(tx, mockTransactionInit));
      });
    });

    describe("fetchEntity", () => {
      beforeEach(async () => {
        await db.transaction(async (tx) => {
          await createEntity(tx, "node", mockProjectNode);
          await createEntity(tx, "node", mockTask2Node);
          await createEntity(tx, "node", mockTask3Node);
        });
      });

      it("fetches node by id", async () => {
        const result = throwIfError(await kg.fetchEntity(mockTask1Node.id));

        expect(result).toEqual(mockTask1Node);
      });

      it("fetches node by uid", async () => {
        const result = throwIfError(await kg.fetchEntity(mockTask1Uid));

        expect(result).toEqual(mockTask1Node);
      });

      it("fetches node by key", async () => {
        const result = throwIfError(await kg.fetchEntity(mockTask1Key));

        expect(result).toEqual(mockTask1Node);
      });

      it("returns error when node doesn't exist", async () => {
        const result = await kg.fetchEntity(NONEXISTENT_NODE_UID);

        expect(result).toBeErr();
      });

      it("fetches node with relationship includes - returns uid without expansion", async () => {
        const result = throwIfError(
          await kg.fetchEntity(mockTask2Node.uid, { uid: true, project: true }),
        );

        expect(result).toEqual({
          uid: mockTask2Node.uid,
          project: mockProjectNode.uid,
        });
      });

      it("applies field selection with includes", async () => {
        const result = throwIfError(
          await kg.fetchEntity(mockTask2Node.uid, {
            title: true,
            project: { includes: { title: true } },
          }),
        );

        expect(result).toEqual({
          title: mockTask2Node.title,
          project: { title: mockProjectNode.title },
        });
      });

      it("applies field selection with two levels of nested includes", async () => {
        await db.transaction(async (tx) => {
          await createEntity(tx, "node", mockUserNode);
          await updateEntity(tx, "node", mockTask2Node.uid, {
            assignedTo: mockUserNode.uid,
          });
        });

        const result = throwIfError(
          await kg.fetchEntity(mockProjectNode.uid, {
            title: true,
            tasks: {
              filters: { uid: mockTask2Node.uid },
              includes: {
                title: true,
                assignedTo: { uid: true, name: true },
              },
            },
          }),
        );

        expect(result).toEqual({
          title: mockProjectNode.title,
          tasks: [
            {
              title: mockTask2Node.title,
              assignedTo: { uid: mockUserNode.uid, name: mockUserNode.name },
            },
          ],
        });
      });

      it("fetches config by uid", async () => {
        const result = throwIfError(
          await kg.fetchEntity(mockTaskType.uid, undefined, "config"),
        );

        expect(result).toEqual(mockTaskType);
      });

      it("fetches config by key", async () => {
        const result = throwIfError(
          await kg.fetchEntity(mockTaskTypeKey as any, undefined, "config"),
        );

        expect(result).toEqual(mockTaskType);
      });

      it("returns error when config doesn't exist", async () => {
        const result = await kg.fetchEntity(
          NONEXISTENT_NODE_UID as ConfigUid,
          undefined,
          "config",
        );

        expect(result).toBeErr();
      });
    });

    describe("update", () => {
      it("processes and applies transaction", async () => {
        let savedTransaction: Transaction | undefined;
        const kgWithCallback = openKnowledgeGraph(db, {
          callbacks: {
            beforeCommit: async (tx: Transaction) => {
              savedTransaction = tx;
              return okVoid;
            },
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

        expect(result.items).toEqual([
          mockTask1Node,
          mockProjectNode,
          mockTask2Node,
          mockTask3Node,
        ]);
        expect(result.pagination).toMatchObject({ hasNext: false });
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

      it("filters by type using array shorthand", async () => {
        const result = throwIfError(
          await kg.search({
            filters: { type: ["Task", "Project"] },
          }),
        );

        expect(result.items).toEqual([
          mockTask1Node,
          mockProjectNode,
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

        expect(result.items).toEqual([mockTask1Node, mockProjectNode]);
        expect(result.pagination).toMatchObject({ hasNext: true });
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

        const types = Object.keys(mockNodeSchemaRaw.types);
        expect(result.items.map((it) => it.key)).toEqual(types);
      });

      it("returns relation uid without expansion when includes is true", async () => {
        const result = throwIfError(
          await kg.search({
            filters: { type: "Task", key: mockTask2Node.key },
            includes: { project: true },
          }),
        );

        expect(result.items).toEqual([{ project: mockProjectNode.uid }]);
      });

      it("expands relation with nested includes", async () => {
        const result = throwIfError(
          await kg.search({
            filters: { type: "Task", key: mockTask2Node.key },
            includes: { project: { uid: true, title: true } },
          }),
        );

        expect(result.items).toEqual([
          {
            project: {
              uid: mockProjectNode.uid,
              title: mockProjectNode.title,
            },
          },
        ]);
      });

      it("does not expand inverse relationship without nested includes", async () => {
        const { mockTasksFieldKey } = await import("./model/config.mock.ts");
        const result = throwIfError(
          await kg.search({
            filters: { type: "Project" },
            includes: { [mockTasksFieldKey]: true },
          }),
        );

        // Inverse relations without nested includes are not expanded
        expect(result.items).toEqual([{}]);
      });

      it("expands inverse relationship with nested includes", async () => {
        const { mockTasksFieldKey } = await import("./model/config.mock.ts");
        const result = throwIfError(
          await kg.search({
            filters: { type: "Project" },
            includes: { [mockTasksFieldKey]: { uid: true, title: true } },
          }),
        );

        expect(result.items).toEqual([
          {
            [mockTasksFieldKey]: [
              { uid: mockTask2Node.uid, title: mockTask2Node.title },
              { uid: mockTask3Node.uid, title: mockTask3Node.title },
            ],
          },
        ]);
      });

      it("applies field selection with includes", async () => {
        const result = throwIfError(
          await kg.search({
            filters: { type: "Task", key: mockTask2Node.key },
            includes: {
              title: true,
              project: { uid: true, title: true },
            },
          }),
        );

        expect(result.items).toEqual([
          {
            title: mockTask2Node.title,
            project: {
              uid: mockProjectNode.uid,
              title: mockProjectNode.title,
            },
          },
        ]);
      });

      it("applies field selection with two levels of nested includes", async () => {
        await db.transaction(async (tx) => {
          await createEntity(tx, "node", mockUserNode);
          await updateEntity(tx, "node", mockTask2Node.uid, {
            assignedTo: mockUserNode.uid,
          });
        });

        const result = throwIfError(
          await kg.search({
            filters: { type: "Project" },
            includes: {
              title: true,
              tasks: {
                filters: { uid: mockTask2Node.uid },
                includes: {
                  title: true,
                  assignedTo: { uid: true, name: true },
                },
              },
            },
          }),
        );

        expect(result.items).toEqual([
          {
            title: mockProjectNode.title,
            tasks: [
              {
                title: mockTask2Node.title,
                assignedTo: { uid: mockUserNode.uid, name: mockUserNode.name },
              },
            ],
          },
        ]);
      });
    });

    describe("rollback", () => {
      it("reverts changes", async () => {
        throwIfError(await kg.update(mockTransactionInputUpdate));
        const updatedNode = throwIfError(await kg.fetchEntity(mockTask1Uid));
        expect(updatedNode).toEqual(mockTaskNode1Updated);

        throwIfError(await kg.rollback(1));

        const rolledBackNode = throwIfError(await kg.fetchEntity(mockTask1Uid));
        expect(rolledBackNode).toEqual(mockTask1Node);
      });

      it("reverts changes with explicit version", async () => {
        throwIfError(await kg.update(mockTransactionInputUpdate));
        const version = throwIfError(await kg.version());
        const updatedNode = throwIfError(await kg.fetchEntity(mockTask1Uid));
        expect(updatedNode).toEqual(mockTaskNode1Updated);

        throwIfError(await kg.rollback(1, version.id));

        const rolledBackNode = throwIfError(await kg.fetchEntity(mockTask1Uid));
        expect(rolledBackNode).toEqual(mockTask1Node);
      });

      it("returns error when version mismatches", async () => {
        throwIfError(await kg.update(mockTransactionInputUpdate));

        const result = await kg.rollback(1, mockTransactionInit.id);

        expect(result).toBeErrWithKey("version-mismatch");
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
