import { beforeEach, describe, expect, it } from "bun:test";
import { throwIfError } from "@binder/utils";
import "@binder/utils/tests";
import {
  mockTask1Node,
  mockTask1Uid,
  mockTaskNode1Updated,
} from "./model/node.mock.ts";
import {
  mockTransactionInit,
  mockTransactionUpdate,
} from "./model/transaction.mock.ts";
import {
  type ConfigKey,
  coreConfigSchema,
  coreSchema,
  emptySchema,
  fieldSystemType,
  type NodeType,
  type TransactionId,
  type TransactionInput,
  typeSystemType,
} from "./model";
import { getTestDatabase, insertConfig } from "./db.mock.ts";
import { type Database } from "./db.ts";
import {
  applyAndSaveTransaction,
  processTransactionInput,
  rollbackTransaction,
} from "./transaction-processor";
import { createEntity, fetchEntity } from "./entity-store.ts";
import {
  fetchTransaction,
  getVersion,
  saveTransaction,
} from "./transaction-store.ts";
import { mockNodeSchema } from "./model/schema.mock.ts";
import { mockTaskType, mockTaskTypeKey } from "./model/config.mock.ts";
import {
  mockTransactionInitInput,
  mockTransactionInputUpdate,
} from "./model/transaction-input.mock.ts";

describe("transaction processor", () => {
  let db: Database;

  beforeEach(async () => {
    db = getTestDatabase();
  });

  describe("processTransaction", () => {
    it("processes transaction input", async () => {
      await db.transaction(async (tx) => {
        await createEntity(tx, "node", mockTask1Node);
        await saveTransaction(tx, mockTransactionInit);
      });

      const result = await db.transaction(async (tx) =>
        throwIfError(
          await processTransactionInput(
            tx,
            mockTransactionInputUpdate,
            mockNodeSchema,
            coreConfigSchema,
          ),
        ),
      );

      expect(result).toEqual(mockTransactionUpdate);
    });

    it("processes transaction input with nodes and config", async () => {
      const result = await db.transaction(async (tx) =>
        throwIfError(
          await processTransactionInput(
            tx,
            mockTransactionInitInput,
            coreSchema(),
            coreConfigSchema,
          ),
        ),
      );

      expect(result).toEqual(mockTransactionInit);
    });

    it("applies transaction and saves to database", async () => {
      await db.transaction(async (tx) => {
        await createEntity(tx, "node", mockTask1Node);
        await saveTransaction(tx, mockTransactionInit);
      });

      await db.transaction(async (tx) =>
        throwIfError(await applyAndSaveTransaction(tx, mockTransactionUpdate)),
      );

      const [updatedNode, transaction] = await db.transaction(async (tx) => [
        throwIfError(await fetchEntity(tx, "node", mockTask1Uid)),
        throwIfError(await fetchTransaction(tx, mockTransactionUpdate.id)),
      ]);

      expect(updatedNode).toEqual(mockTaskNode1Updated);
      expect(transaction).toEqual(mockTransactionUpdate);
    });

    it("returns errors where there is configuration issue", async () => {
      const result = await db.transaction(async (tx) =>
        processTransactionInput(
          tx,
          {
            configurations: [{ type: fieldSystemType, dataType: "plaintext" }],
            author: "test",
          },
          mockNodeSchema,
          coreConfigSchema,
        ),
      );

      expect(result).toBeErrWithKey("changeset-input-process-failed");
    });
  });

  it("returns errors where there is node issue", async () => {
    const result = await db.transaction(async (tx) =>
      processTransactionInput(
        tx,
        {
          nodes: [{ type: mockTaskTypeKey }],
          author: "test",
        },
        mockNodeSchema,
        coreConfigSchema,
      ),
    );

    expect(result).toBeErrWithKey("changeset-input-process-failed");
  });

  describe("config and node changes in same transaction", () => {
    it("validates node against newly added config from same transaction", async () => {
      const newFieldKey = "priority" as ConfigKey;
      const newTypeKey = "Bug" as NodeType;

      const result = await db.transaction(async (tx) =>
        processTransactionInput(
          tx,
          {
            configurations: [
              {
                type: fieldSystemType,
                key: newFieldKey,
                dataType: "plaintext",
              },
              {
                type: typeSystemType,
                key: newTypeKey,
                name: "Bug",
                fields: [[newFieldKey, { required: true }]],
              },
            ],
            nodes: [{ type: newTypeKey }],
            author: "test",
          },
          emptySchema(),
          coreConfigSchema,
        ),
      );

      expect(result).toBeErrWithKey("changeset-input-process-failed");
    });

    it("validates node against updated config from same transaction", async () => {
      const newFieldKey = "severity" as ConfigKey;
      await insertConfig(db, mockTaskType);

      const result = await db.transaction(async (tx) =>
        processTransactionInput(
          tx,
          {
            configurations: [
              {
                type: fieldSystemType,
                key: newFieldKey,
                dataType: "plaintext",
              },
              {
                $ref: mockTaskTypeKey,
                fields: [[newFieldKey, { required: true }]],
              },
            ],
            nodes: [{ type: mockTaskTypeKey, title: "Test Task" }],
            author: "test",
          },
          mockNodeSchema,
          coreConfigSchema,
        ),
      );

      expect(result).toBeErrWithKey("changeset-input-process-failed");
    });

    it("normalizes ObjTuple relation values to tuple format in stored changeset", async () => {
      const newFieldKey = "summary" as ConfigKey;
      const newTypeKey = "Issue" as NodeType;

      const result = await db.transaction(async (tx) =>
        processTransactionInput(
          tx,
          {
            configurations: [
              {
                type: fieldSystemType,
                key: newFieldKey,
                dataType: "plaintext",
              },
              {
                type: typeSystemType,
                key: newTypeKey,
                name: "Issue",
                fields: [{ [newFieldKey]: { required: true } }, "description"],
              },
            ],
            author: "test",
          },
          emptySchema(),
          coreConfigSchema,
        ),
      );

      expect(result).toBeOk();
      const transaction = throwIfError(result);
      expect(transaction.configurations[newTypeKey].fields).toEqual([
        [newFieldKey, { required: true }],
        "description",
      ]);
    });
  });

  describe("rollbackTransaction", () => {
    const getNode = async () =>
      await db.transaction(async (tx) =>
        throwIfError(await fetchEntity(tx, "node", mockTask1Uid)),
      );
    const getCurrentVersion = async () =>
      await db.transaction(async (tx) => throwIfError(await getVersion(tx)));
    const applyTransactionInput = async (input: TransactionInput) =>
      await db.transaction(async (tx) => {
        const transaction = throwIfError(
          await processTransactionInput(
            tx,
            input,
            mockNodeSchema,
            coreConfigSchema,
          ),
        );
        throwIfError(await applyAndSaveTransaction(tx, transaction));
      });

    it("rolls back ;", async () => {
      await applyTransactionInput(mockTransactionInitInput);
      await applyTransactionInput(mockTransactionInputUpdate);
      expect(await getNode()).toEqual(mockTaskNode1Updated);

      await db.transaction(async (tx) => {
        const version = throwIfError(await getVersion(tx));
        return throwIfError(await rollbackTransaction(tx, 1, version.id));
      });

      expect(await getNode()).toEqual(mockTask1Node);
      expect((await getCurrentVersion()).id).toBe(1 as TransactionId);
    });

    it("rolls back 3 transactions", async () => {
      await applyTransactionInput(mockTransactionInitInput);
      await applyTransactionInput(mockTransactionInputUpdate);
      await applyTransactionInput({
        author: "test",
        nodes: [{ $ref: mockTask1Uid, description: "Updated description" }],
      });
      await applyTransactionInput({
        author: "test",
        nodes: [{ $ref: mockTask1Uid, status: "complete" }],
      });

      await db.transaction(async (tx) => {
        const version = throwIfError(await getVersion(tx));
        return throwIfError(await rollbackTransaction(tx, 3, version.id));
      });

      expect(await getNode()).toEqual(mockTask1Node);
      expect((await getCurrentVersion()).id).toBe(1 as TransactionId);
    });

    it("returns error when count is too large", async () => {
      const result = await db.transaction(async (tx) => {
        const version = throwIfError(await getVersion(tx));
        return rollbackTransaction(tx, 5, version.id);
      });

      expect(result).toBeErr();
    });

    it("returns error when version mismatches", async () => {
      await applyTransactionInput(mockTransactionInitInput);
      await applyTransactionInput(mockTransactionInputUpdate);

      const result = await db.transaction(async (tx) =>
        rollbackTransaction(tx, 1, 1 as TransactionId),
      );

      expect(result).toBeErrWithKey("version-mismatch");
    });

    it("can rollback transaction 1 to genesis state", async () => {
      await applyTransactionInput(mockTransactionInitInput);
      expect((await getCurrentVersion()).id).toBe(1 as TransactionId);

      await db.transaction(async (tx) => {
        const version = throwIfError(await getVersion(tx));
        return throwIfError(await rollbackTransaction(tx, 1, version.id));
      });

      const version = await getCurrentVersion();
      expect(version.id).toBe(0 as TransactionId);
    });
  });
});
