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
  mockTransactionInputUpdate,
  mockTransactionUpdate,
} from "./model/transaction.mock.ts";
import { type TransactionId, type TransactionInput } from "./model";
import { getTestDatabase } from "./db.mock.ts";
import { type Database } from "./db.ts";
import {
  applyTransaction,
  processTransactionInput,
  rollbackTransaction,
} from "./transaction-processor";
import { createEntity, fetchEntity } from "./entity-store.ts";
import {
  fetchTransaction,
  getVersion,
  saveTransaction,
} from "./transaction-store.ts";

describe("transaction processor", () => {
  let db: Database;

  const applyTransactionInput = async (input: TransactionInput) =>
    await db.transaction(async (tx) => {
      const transaction = throwIfError(
        await processTransactionInput(tx, input),
      );
      throwIfError(await applyTransaction(tx, transaction));
    });

  const getNode = async () =>
    await db.transaction(async (tx) =>
      throwIfError(await fetchEntity(tx, "node", mockTask1Uid)),
    );

  const getCurrentVersion = async () =>
    await db.transaction(async (tx) => throwIfError(await getVersion(tx)));

  beforeEach(async () => {
    db = getTestDatabase();
    await db.transaction(async (tx) => {
      await createEntity(tx, "node", mockTask1Node);
      await saveTransaction(tx, mockTransactionInit);
    });
  });

  describe("processTransaction", () => {
    it("processes transaction input", async () => {
      const result = await db.transaction(async (tx) =>
        throwIfError(
          await processTransactionInput(tx, mockTransactionInputUpdate),
        ),
      );

      expect(result).toEqual(mockTransactionUpdate);
    });

    it("applies transaction and saves to database", async () => {
      await db.transaction(async (tx) =>
        throwIfError(await applyTransaction(tx, mockTransactionUpdate)),
      );

      const [updatedNode, transaction] = await db.transaction(async (tx) => [
        throwIfError(await fetchEntity(tx, "node", mockTask1Uid)),
        throwIfError(await fetchTransaction(tx, mockTransactionUpdate.id)),
      ]);

      expect(updatedNode).toEqual(mockTaskNode1Updated);
      expect(transaction).toEqual(mockTransactionUpdate);
    });
  });

  describe("rollbackTransaction", () => {
    it("rolls back 1 transaction", async () => {
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
      await applyTransactionInput(mockTransactionInputUpdate);
      await applyTransactionInput({
        author: "test",
        nodes: [{ $ref: mockTask1Uid, description: "Updated description" }],
      });
      await applyTransactionInput({
        author: "test",
        nodes: [{ $ref: mockTask1Uid, taskStatus: "done" }],
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
      await applyTransactionInput(mockTransactionInputUpdate);

      const result = await db.transaction(async (tx) =>
        rollbackTransaction(tx, 1, 1 as TransactionId),
      );

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
