import { beforeEach, describe, expect, it } from "bun:test";
import { throwIfError } from "@binder/utils";
import "@binder/utils/tests";
import {
  mockTask1Record,
  mockTask1Uid,
  mockTaskRecord1Updated,
} from "./model/record.mock.ts";
import {
  mockTransactionInit,
  mockTransactionUpdate,
} from "./model/transaction.mock.ts";
import {
  coreConfigSchema,
  type TransactionId,
  type TransactionInput,
} from "./model";
import { getTestDatabase } from "./db.mock.ts";
import { type Database } from "./db.ts";
import {
  applyAndSaveTransaction,
  rollbackTransaction,
} from "./transaction-applier";
import { processTransactionInput } from "./transaction-processor";
import { createEntity, fetchEntity } from "./entity-store.ts";
import {
  fetchTransaction,
  getVersion,
  saveTransaction,
} from "./transaction-store.ts";
import { mockRecordSchema } from "./model/schema.mock.ts";
import {
  mockTransactionInitInput,
  mockTransactionInputUpdate,
} from "./model/transaction-input.mock.ts";

describe("transaction applier", () => {
  let db: Database;

  beforeEach(() => {
    db = getTestDatabase();
  });

  describe("applyAndSaveTransaction", () => {
    it("applies transaction and saves to database", async () => {
      await db.transaction(async (tx) => {
        await createEntity(tx, "record", mockTask1Record);
        await saveTransaction(tx, mockTransactionInit);
      });

      await db.transaction(async (tx) =>
        throwIfError(await applyAndSaveTransaction(tx, mockTransactionUpdate)),
      );

      const [updatedRecord, transaction] = await db.transaction(async (tx) => [
        throwIfError(await fetchEntity(tx, "record", mockTask1Uid)),
        throwIfError(await fetchTransaction(tx, mockTransactionUpdate.id)),
      ]);

      expect(updatedRecord).toEqual(mockTaskRecord1Updated);
      expect(transaction).toEqual(mockTransactionUpdate);
    });
  });

  describe("rollbackTransaction", () => {
    const getRecord = async () =>
      db.transaction(async (tx) =>
        throwIfError(await fetchEntity(tx, "record", mockTask1Uid)),
      );
    const getCurrentVersion = async () =>
      db.transaction(async (tx) => throwIfError(await getVersion(tx)));
    const applyTransactionInput = async (input: TransactionInput) =>
      db.transaction(async (tx) => {
        const transaction = throwIfError(
          await processTransactionInput(
            tx,
            input,
            mockRecordSchema,
            coreConfigSchema,
          ),
        );
        throwIfError(await applyAndSaveTransaction(tx, transaction));
      });
    const check = async (
      count: number,
      expected: { record?: typeof mockTask1Record; versionId: TransactionId },
    ) => {
      await db.transaction(async (tx) => {
        const version = throwIfError(await getVersion(tx));
        throwIfError(await rollbackTransaction(tx, count, version.id));
      });
      if (expected.record !== undefined) {
        expect(await getRecord()).toEqual(expected.record);
      }
      expect((await getCurrentVersion()).id).toBe(expected.versionId);
    };

    it("rolls back", async () => {
      await applyTransactionInput(mockTransactionInitInput);
      await applyTransactionInput(mockTransactionInputUpdate);
      expect(await getRecord()).toEqual(mockTaskRecord1Updated);

      await check(1, {
        record: mockTask1Record,
        versionId: 1 as TransactionId,
      });
    });

    it("rolls back 3 transactions", async () => {
      await applyTransactionInput(mockTransactionInitInput);
      await applyTransactionInput(mockTransactionInputUpdate);
      await applyTransactionInput({
        author: "test",
        records: [{ uid: mockTask1Uid, description: "Updated description" }],
      });
      await applyTransactionInput({
        author: "test",
        records: [{ uid: mockTask1Uid, status: "complete" }],
      });

      await check(3, {
        record: mockTask1Record,
        versionId: 1 as TransactionId,
      });
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

      await check(1, { versionId: 0 as TransactionId });
    });
  });
});
