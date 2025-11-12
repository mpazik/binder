import { newIsoTimestamp } from "@binder/utils";
import {
  GENESIS_VERSION,
  type Transaction,
  type TransactionHash,
  type TransactionId,
  type TransactionInput,
} from "./transaction.ts";
import { changesetInputForNewEntity } from "./changeset.ts";
import {
  mockProjectNode,
  mockTask1Node,
  mockTask1Uid,
  mockTask2Node,
} from "./node.mock.ts";
import {
  mockChangesetCreateTask1,
  mockChangesetUpdateTask1,
} from "./changeset.mock.ts";
import { mockNodeSchema } from "./schema.mock.ts";

export const mockTransactionInitId = 1 as TransactionId;
export const mockTransactionInitHash =
  "db51c6faa16d75b6245e40dead0691ae6d3707e3b9f1e1600334e7d6da54d72d" as TransactionHash;

export const mockAuthor = "test-user";
export const mockAuthor2 = "test-user2";
const mockCreated = newIsoTimestamp("2024-01-01");
const mockUpdated = newIsoTimestamp("2024-01-02");
export const mockTransactionInit: Transaction = {
  id: mockTransactionInitId,
  previous: GENESIS_VERSION.hash,
  hash: mockTransactionInitHash,
  nodes: {
    [mockTask1Uid]: mockChangesetCreateTask1,
    [mockProjectNode.uid]: mockProjectNode,
    [mockTask2Node.uid]: mockTask2Node,
  },
  configurations: {
    ...Object.fromEntries(
      Object.values(mockNodeSchema.fields).map((field) => [field.key, field]),
    ),
    ...Object.fromEntries(
      Object.values(mockNodeSchema.types).map((type) => [type.key, type]),
    ),
  },
  author: mockAuthor,
  createdAt: mockCreated,
};

export const mockTransactionUpdateId = 2 as TransactionId;
export const mockTransactionUpdateHash =
  "b32ffd80b917a75d786ca55c9a222646373112c020f5fbb6c342520f6cade537" as TransactionHash;
export const mockTransactionUpdate: Transaction = {
  id: mockTransactionUpdateId,
  previous: mockTransactionInitHash,
  hash: mockTransactionUpdateHash,
  nodes: {
    [mockTask1Uid]: mockChangesetUpdateTask1,
  },
  configurations: {},
  author: mockAuthor,
  createdAt: mockUpdated,
};

export const mockTransactionInitInput: TransactionInput = {
  author: mockAuthor,
  createdAt: mockCreated,
  nodes: [
    changesetInputForNewEntity(mockTask1Node),
    changesetInputForNewEntity(mockProjectNode),
    changesetInputForNewEntity(mockTask2Node),
  ],
  configurations: [
    ...Object.values(mockNodeSchema.fields).map((field) =>
      changesetInputForNewEntity<"config">(field),
    ),
    ...Object.values(mockNodeSchema.types).map((type) =>
      changesetInputForNewEntity<"config">(type),
    ),
  ],
};

export const mockTransactionInputUpdate: TransactionInput = {
  author: mockAuthor,
  createdAt: mockUpdated,
  nodes: [
    {
      $ref: mockTask1Uid,
      title: "Implement user authentication system",
      tags: [["insert", "completed", 1]],
    },
  ],
  configurations: [],
};

export const mockTransaction3Id = 3 as TransactionId;
export const mockTransaction3Hash =
  "a123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as TransactionHash;

export const mockTransaction3: Transaction = {
  id: mockTransaction3Id,
  previous: mockTransactionUpdateHash,
  hash: mockTransaction3Hash,
  nodes: {
    [mockTask2Node.uid]: {
      status: {
        op: "set",
        previous: "todo",
        value: "in_progress",
      },
    },
  },
  configurations: {},
  author: mockAuthor2,
  createdAt: newIsoTimestamp("2024-01-03"),
};

export const mockTransaction4Id = 4 as TransactionId;
export const mockTransaction4Hash =
  "b234567890abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as TransactionHash;
export const mockTransaction4: Transaction = {
  id: mockTransaction4Id,
  previous: mockTransaction3Hash,
  hash: mockTransaction4Hash,
  nodes: {
    [mockProjectNode.uid]: {
      status: {
        op: "set",
        previous: "in_progress",
        value: "completed",
      },
    },
  },
  configurations: {},
  author: mockAuthor2,
  createdAt: newIsoTimestamp("2024-01-04"),
};
