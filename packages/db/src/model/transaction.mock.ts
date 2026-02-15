import { newIsoTimestamp } from "@binder/utils";
import {
  GENESIS_VERSION,
  type Transaction,
  type TransactionHash,
  type TransactionId,
} from "./transaction.ts";
import {
  mockProjectRecord,
  mockTask1Uid,
  mockTask2Record,
} from "./record.mock.ts";
import {
  mockChangesetCreateTask1,
  mockChangesetUpdateTask1,
} from "./changeset.mock.ts";
import { mockRecordSchemaRaw } from "./schema.mock.ts";
import type { RecordFieldDef } from "./config.ts";

export const mockTransactionInitId = 1 as TransactionId;
export const mockTransactionInitHash =
  "LKISFX2HT3vwyeISLK5RUAtSt1LozER69L7b_BDRzSM" as TransactionHash;

export const mockAuthor = "test-user";
export const mockAuthor2 = "test-user2";
export const mockCreatedTime = newIsoTimestamp("2024-01-01");
export const mockUpdatedTime = newIsoTimestamp("2024-01-02");
export const mockTransactionInit: Transaction = {
  id: mockTransactionInitId,
  hash: mockTransactionInitHash,
  previous: GENESIS_VERSION.hash,
  createdAt: mockCreatedTime,
  author: mockAuthor,
  records: {
    [mockTask1Uid]: mockChangesetCreateTask1,
    [mockProjectRecord.uid]: mockProjectRecord,
    [mockTask2Record.uid]: mockTask2Record,
  },
  configs: {
    ...Object.fromEntries(
      Object.values(mockRecordSchemaRaw.fields).map((field) => [
        field.key,
        field,
      ]),
    ),
    ...Object.fromEntries(
      Object.values(mockRecordSchemaRaw.types).map((type) => [type.key, type]),
    ),
  },
};

export const mockTransactionUpdateId = 2 as TransactionId;
export const mockTransactionUpdateHash =
  "Z2wU6cOet_7Rm_JFH3uxyuesqpxAfujs_sq9LAidto8" as TransactionHash;
export const mockTransactionUpdate: Transaction = {
  id: mockTransactionUpdateId,
  hash: mockTransactionUpdateHash,
  previous: mockTransactionInitHash,
  createdAt: mockUpdatedTime,
  author: mockAuthor,
  records: {
    [mockTask1Uid]: mockChangesetUpdateTask1,
  },
  configs: {},
};

export const mockTransaction3Id = 3 as TransactionId;
export const mockTransaction3Hash =
  "oBIjRWeZq83wEjRWeZq83wEjRWeZq83wEjRWeZq83wE" as TransactionHash;

export const mockTransaction3: Transaction = {
  id: mockTransaction3Id,
  hash: mockTransaction3Hash,
  previous: mockTransactionUpdateHash,
  createdAt: newIsoTimestamp("2024-01-03"),
  author: mockAuthor2,
  records: {
    [mockTask2Record.uid]: {
      status: ["set", "active", "pending"],
    },
  },
  configs: {},
};

export const mockTransaction4Id = 4 as TransactionId;
export const mockTransaction4Hash =
  "sjRWeJCr3O8SNFZ4kKvN7xI0VniQq8zvEjRWeJCr3O8" as TransactionHash;
export const mockTransaction4: Transaction = {
  id: mockTransaction4Id,
  hash: mockTransaction4Hash,
  previous: mockTransaction3Hash,
  createdAt: newIsoTimestamp("2024-01-04"),
  author: mockAuthor2,
  records: {
    [mockProjectRecord.uid]: {
      status: ["set", "complete", "active"],
    },
  },
  configs: {},
};
