import { beforeEach, describe, expect, it } from "bun:test";
import { throwIfError } from "@binder/utils";
import "@binder/utils/tests";
import { getTestDatabase } from "./db.mock";
import { openKnowledgeGraph } from "./knowledge-graph.ts";
import type { Database } from "./db.ts";
import { createEntity, fetchEntity } from "./entity-store.ts";
import { saveTransaction } from "./transaction-store.ts";
import {
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
  mockTransactionInputUpdate,
  mockTransactionUpdate,
} from "./model/transaction.mock.ts";
import {
  mockTaskType,
  mockTaskTypeKey,
  mockTaskTypeUid,
} from "./model/config.mock.ts";
import {
  type ConfigUid,
  GENESIS_VERSION,
  type Transaction,
  versionFromTransaction,
} from "./model";

describe("knowledge graph", () => {
  let db: Database;
  let kg: ReturnType<typeof openKnowledgeGraph>;

  beforeEach(async () => {
    db = getTestDatabase();
    kg = openKnowledgeGraph(db);

    await db.transaction(async (tx) => {
      await createEntity(tx, "node", mockTask1Node);
      await createEntity(tx, "config", mockTaskType);
      await saveTransaction(tx, mockTransactionInit);
    });
  });

  describe("fetchNode", () => {
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
  });

  describe("fetchConfig", () => {
    it("fetches config by uid", async () => {
      const result = throwIfError(await kg.fetchConfig(mockTaskTypeUid));

      expect(result).toEqual(mockTaskType);
    });

    it("fetches config by key", async () => {
      const result = throwIfError(await kg.fetchConfig(mockTaskTypeKey));

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
        onTransactionSaved: (tx) => {
          savedTransaction = tx;
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

  describe("version", () => {
    it("returns correct version for empty knowledge graph", async () => {
      db = getTestDatabase();
      kg = openKnowledgeGraph(db);

      const result = throwIfError(await kg.version());

      expect(result).toEqual(GENESIS_VERSION);
    });

    it("returns version before and after update", async () => {
      const result = throwIfError(await kg.version());
      expect(result).toEqual(versionFromTransaction(mockTransactionInit));

      throwIfError(await kg.update(mockTransactionInputUpdate));

      const updatedResult = throwIfError(await kg.version());
      expect(updatedResult).toEqual(
        versionFromTransaction(mockTransactionUpdate),
      );
    });
  });

  describe("search", () => {
    beforeEach(async () => {
      await db.transaction(async (tx) => {
        const { mockTask2Node, mockTask3Node, mockProjectNode } = await import(
          "./model/node.mock.ts"
        );
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
