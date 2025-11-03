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
  "ca2fdd762719841ec80c52df46b3d2070f88c75506eefac70cb13c21789086b0" as TransactionHash;

const mockAuthor = "test-user";
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
  "e413afa51b8ef65efb5810765403ddbfc433232ca07dcc49a7926c088570dda5" as TransactionHash;
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
