import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { throwIfError } from "@binder/utils";
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
import { getTestDatabase } from "./db.mock.ts";
import { type Database } from "./db.ts";
import {
  applyTransaction,
  processTransactionInput,
} from "./transaction-processor";
import { createEntity, fetchEntity } from "./entity-store.ts";
import { fetchTransaction, saveTransaction } from "./transaction-store.ts";

describe("transaction processor", () => {
  let db: Database;

  beforeEach(async () => {
    db = getTestDatabase();
    await db.transaction(async (tx) => {
      await createEntity(tx, "node", mockTask1Node);
      await saveTransaction(tx, mockTransactionInit);
    });
  });

  it("processes transaction input", async () => {
    const result = await db.transaction(async (tx) =>
      throwIfError(
        await processTransactionInput(tx, mockTransactionInputUpdate),
      ),
    );

    expect(result).toEqual(mockTransactionUpdate);
  });

  it("applies transaction and saves to database", async () => {
    await db.transaction(async (tx) => {
      throwIfError(await applyTransaction(tx, mockTransactionUpdate));
    });
    const [updatedNode, transaction] = await db.transaction(async (tx) => [
      throwIfError(await fetchEntity(tx, "node", mockTask1Uid)),
      throwIfError(await fetchTransaction(tx, mockTransactionUpdate.id)),
    ]);

    expect(updatedNode).toEqual(mockTaskNode1Updated);
    expect(transaction).toEqual(mockTransactionUpdate);
  });
});
