import { beforeEach, describe, expect, it } from "bun:test";
import { throwIfError, throwIfValue } from "@binder/utils";
import "@binder/utils/tests";
import {
  mockTask1Node,
  mockTask1Uid,
  mockTaskNode1Updated,
} from "./model/node.mock.ts";
import {
  mockTransactionInit,
  mockTransactionInitInput,
  mockTransactionInputUpdate,
  mockTransactionUpdate,
} from "./model/transaction.mock.ts";
import {
  configSchema,
  emptyNodeSchema,
  fieldConfigType,
  type TransactionId,
  type TransactionInput,
} from "./model";
import { getTestDatabase } from "./db.mock.ts";
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
import { mockTaskTypeKey } from "./model/config.mock.ts";

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
            configSchema,
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
            emptyNodeSchema,
            configSchema,
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
            configurations: [{ type: fieldConfigType, dataType: "string" }],
            author: "test",
          },
          mockNodeSchema,
          configSchema,
        ),
      );

      expect(throwIfValue(result)).toEqual({
        key: "changeset-input-process-failed",
        message: "failed creating changeset",
        data: {
          errors: [
            {
              changesetIndex: 0,
              namespace: "config",
              fieldKey: "key",
              message: "mandatory property is missing or null",
            },
          ],
        },
      });
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
        configSchema,
      ),
    );

    expect(throwIfValue(result)).toEqual({
      key: "changeset-input-process-failed",
      message: "failed creating changeset",
      data: {
        errors: [
          {
            changesetIndex: 0,
            namespace: "node",
            fieldKey: "title",
            message: "mandatory property is missing or null",
          },
        ],
      },
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
            configSchema,
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
        nodes: [{ $ref: mockTask1Uid, status: "done" }],
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

      expect(result).toBeErr();
      expect(result).toEqual(
        expect.objectContaining({
          error: expect.objectContaining({
            key: "version-mismatch",
          }),
        }),
      );
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
