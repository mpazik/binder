import { newIsoTimestamp } from "@binder/utils";
import {
  GENESIS_VERSION,
  type Transaction,
  type TransactionHash,
  type TransactionId,
} from "./transaction.ts";
import { mockProjectNode, mockTask1Uid, mockTask2Node } from "./node.mock.ts";
import {
  mockChangesetCreateTask1,
  mockChangesetUpdateTask1,
} from "./changeset.mock.ts";
import { mockNodeSchemaRaw } from "./schema.mock.ts";

export const mockTransactionInitId = 1 as TransactionId;
export const mockTransactionInitHash =
  "30_0X51GcpycIgAtdH8RLk1_wf4n70jxJ2TMZlzy_FQ" as TransactionHash;

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
  nodes: {
    [mockTask1Uid]: mockChangesetCreateTask1,
    [mockProjectNode.uid]: mockProjectNode,
    [mockTask2Node.uid]: mockTask2Node,
  },
  configurations: {
    ...Object.fromEntries(
      Object.values(mockNodeSchemaRaw.fields).map((field) => [
        field.key,
        field,
      ]),
    ),
    ...Object.fromEntries(
      Object.values(mockNodeSchemaRaw.types).map((type) => [type.key, type]),
    ),
  },
};

export const mockTransactionUpdateId = 2 as TransactionId;
export const mockTransactionUpdateHash =
  "UWPVCf3s15oD_XshdVHQXiYzG3ZWKlR8MlzRgL-ZdtA" as TransactionHash;
export const mockTransactionUpdate: Transaction = {
  id: mockTransactionUpdateId,
  hash: mockTransactionUpdateHash,
  previous: mockTransactionInitHash,
  createdAt: mockUpdatedTime,
  author: mockAuthor,
  nodes: {
    [mockTask1Uid]: mockChangesetUpdateTask1,
  },
  configurations: {},
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
  nodes: {
    [mockTask2Node.uid]: {
      status: ["set", "active", "pending"],
    },
  },
  configurations: {},
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
  nodes: {
    [mockProjectNode.uid]: {
      status: ["set", "complete", "active"],
    },
  },
  configurations: {},
};
