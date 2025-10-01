import {
  GENESIS_VERSION,
  type Transaction,
  type TransactionHash,
  type TransactionId,
  type TransactionInput,
} from "./transaction.ts";
import {
  changesetInputForNewEntity,
  type ConfigurationsChangeset,
} from "./changeset.ts";
import {
  mockProjectNode,
  mockTask1Node,
  mockTask1Uid,
  mockTask2Node,
  mockTaskNode1Updated,
} from "./node.mock.ts";
import {
  mockChangesetCreateTask1,
  mockChangesetUpdateTask1,
} from "./changeset.mock.ts";

export const mockTransactionInitId = 1 as TransactionId;
export const mockTransactionInitHash =
  "567e574235ec98dccb362ca1607fecc7ee80e103e5807a143daed22d2830506f" as TransactionHash;

export const mockConfigurationsChangeset: ConfigurationsChangeset = {};

const mockAuthor = "test-user";
export const mockTransactionInit: Transaction = {
  id: mockTransactionInitId,
  previous: GENESIS_VERSION.hash,
  hash: mockTransactionInitHash,
  nodes: {
    [mockTask1Uid]: mockChangesetCreateTask1,
  },
  configurations: mockConfigurationsChangeset,
  author: mockAuthor,
  createdAt: mockTask1Node.createdAt,
};

export const mockTransactionUpdateId = 2 as TransactionId;
export const mockTransactionUpdateHash =
  "46f6543886dc178c49ee06394a938b6153563780c4456dda38addd0d3e4be490" as TransactionHash;
export const mockTransactionUpdate: Transaction = {
  id: mockTransactionUpdateId,
  previous: mockTransactionInitHash,
  hash: mockTransactionUpdateHash,
  nodes: {
    [mockTask1Uid]: mockChangesetUpdateTask1,
  },
  configurations: mockConfigurationsChangeset,
  author: mockAuthor,
  createdAt: mockTaskNode1Updated.updatedAt as any,
};

export const mockTransactionInitInput: TransactionInput = {
  author: mockAuthor,
  createdAt: mockTask1Node.createdAt,
  nodes: [
    changesetInputForNewEntity(mockTask1Node),
    changesetInputForNewEntity(mockProjectNode),
    changesetInputForNewEntity(mockTask2Node),
  ],
  configurations: [],
};

export const mockTransactionInputUpdate: TransactionInput = {
  author: mockAuthor,
  createdAt: mockTaskNode1Updated.updatedAt,
  nodes: [
    {
      $ref: mockTask1Uid,
      title: "Implement user authentication system",
      tags: [{ kind: "insert", value: "completed", position: 1 }],
    },
  ],
  configurations: [],
};
