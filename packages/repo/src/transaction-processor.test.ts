import { beforeEach, describe, expect, it } from "bun:test";
import { throwIfError } from "@binder/utils";
import "@binder/utils/tests";
import { mockTask1Record } from "./model/record.mock.ts";
import {
  mockTransactionInit,
  mockTransactionUpdate,
} from "./model/transaction.mock.ts";
import {
  type ConfigKey,
  coreConfigSchema,
  coreRecordSchema,
  emptySchema,
  fieldSystemType,
  type RecordType,
  typeSystemType,
} from "./model";
import { getTestDatabase, insertConfig } from "./db.mock.ts";
import { type Database } from "./db.ts";
import { processTransactionInput } from "./transaction-processor";
import { createEntity } from "./entity-store.ts";
import { saveTransaction } from "./transaction-store.ts";
import { mockRecordSchema } from "./model/schema.mock.ts";
import { mockTaskType, mockTaskTypeKey } from "./model/config.mock.ts";
import {
  mockTransactionInitInput,
  mockTransactionInputUpdate,
} from "./model/transaction-input.mock.ts";

describe("transaction processor", () => {
  let db: Database;

  beforeEach(() => {
    db = getTestDatabase();
  });

  describe("processTransaction", () => {
    it("processes transaction input", async () => {
      await db.transaction(async (tx) => {
        await createEntity(tx, "record", mockTask1Record);
        await saveTransaction(tx, mockTransactionInit);
      });

      const result = await db.transaction(async (tx) =>
        throwIfError(
          await processTransactionInput(
            tx,
            mockTransactionInputUpdate,
            mockRecordSchema,
            coreConfigSchema,
          ),
        ),
      );

      expect(result).toEqual(mockTransactionUpdate);
    });

    it("processes transaction input with records and config", async () => {
      const result = await db.transaction(async (tx) =>
        throwIfError(
          await processTransactionInput(
            tx,
            mockTransactionInitInput,
            coreRecordSchema(),
            coreConfigSchema,
          ),
        ),
      );

      expect(result).toEqual(mockTransactionInit);
    });

    it("returns errors where there is configuration issue", async () => {
      const result = await db.transaction(async (tx) =>
        processTransactionInput(
          tx,
          {
            configs: [{ type: fieldSystemType, dataType: "plaintext" }],
            author: "test",
          },
          mockRecordSchema,
          coreConfigSchema,
        ),
      );

      expect(result).toBeErrWithKey("changeset-input-process-failed");
    });

    it("returns errors where there is record issue", async () => {
      const result = await db.transaction(async (tx) =>
        processTransactionInput(
          tx,
          {
            records: [{ type: mockTaskTypeKey }],
            author: "test",
          },
          mockRecordSchema,
          coreConfigSchema,
        ),
      );

      expect(result).toBeErrWithKey("changeset-input-process-failed");
    });
  });

  describe("config and record changes in same transaction", () => {
    it("validates record against newly added config from same transaction", async () => {
      const newFieldKey = "priority" as ConfigKey;
      const newTypeKey = "Bug" as RecordType;

      const result = await db.transaction(async (tx) =>
        processTransactionInput(
          tx,
          {
            configs: [
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
            records: [{ type: newTypeKey }],
            author: "test",
          },
          emptySchema(),
          coreConfigSchema,
        ),
      );

      expect(result).toBeErrWithKey("changeset-input-process-failed");
    });

    it("validates record against updated config from same transaction", async () => {
      const newFieldKey = "severity" as ConfigKey;
      await insertConfig(db, mockTaskType);

      const result = await db.transaction(async (tx) =>
        processTransactionInput(
          tx,
          {
            configs: [
              {
                type: fieldSystemType,
                key: newFieldKey,
                dataType: "plaintext",
              },
              {
                key: mockTaskTypeKey,
                fields: [[newFieldKey, { required: true }]],
              },
            ],
            records: [{ type: mockTaskTypeKey, title: "Test Task" }],
            author: "test",
          },
          mockRecordSchema,
          coreConfigSchema,
        ),
      );

      expect(result).toBeErrWithKey("changeset-input-process-failed");
    });

    it("normalizes ObjTuple relation values to tuple format in stored changeset", async () => {
      const newFieldKey = "summary" as ConfigKey;
      const newTypeKey = "Issue" as RecordType;

      const result = await db.transaction(async (tx) =>
        processTransactionInput(
          tx,
          {
            configs: [
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
      expect(transaction.configs[newTypeKey].fields).toEqual([
        [newFieldKey, { required: true }],
        "description",
      ]);
    });
  });
});
