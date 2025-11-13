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
  "52f57d28141fbfeb30924525bfbdeda52caaf7af6634377f0701ca62982dab3e" as TransactionHash;

export const mockAuthor = "test-user";
export const mockAuthor2 = "test-user2";
const mockCreated = newIsoTimestamp("2024-01-01");
const mockUpdated = newIsoTimestamp("2024-01-02");
export const mockTransactionInit: Transaction = {
  id: mockTransactionInitId,
  hash: mockTransactionInitHash,
  previous: GENESIS_VERSION.hash,
  createdAt: mockCreated,
  author: mockAuthor,
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
};

export const mockTransactionUpdateId = 2 as TransactionId;
export const mockTransactionUpdateHash =
  "4777981cfea53fd0977297a3b9f1c6a3031a834131557ce9c9f6a3a7209d5fb8" as TransactionHash;
export const mockTransactionUpdate: Transaction = {
  id: mockTransactionUpdateId,
  hash: mockTransactionUpdateHash,
  previous: mockTransactionInitHash,
  createdAt: mockUpdated,
  author: mockAuthor,
  nodes: {
    [mockTask1Uid]: mockChangesetUpdateTask1,
  },
  configurations: {},
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
  hash: mockTransaction3Hash,
  previous: mockTransactionUpdateHash,
  createdAt: newIsoTimestamp("2024-01-03"),
  author: mockAuthor2,
  nodes: {
    [mockTask2Node.uid]: {
      status: {
        op: "set",
        value: "in_progress",
        previous: "todo",
      },
    },
  },
  configurations: {},
};

export const mockTransaction4Id = 4 as TransactionId;
export const mockTransaction4Hash =
  "b234567890abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as TransactionHash;
export const mockTransaction4: Transaction = {
  id: mockTransaction4Id,
  hash: mockTransaction4Hash,
  previous: mockTransaction3Hash,
  createdAt: newIsoTimestamp("2024-01-04"),
  author: mockAuthor2,
  nodes: {
    [mockProjectNode.uid]: {
      status: {
        op: "set",
        value: "completed",
        previous: "in_progress",
      },
    },
  },
  configurations: {},
};
