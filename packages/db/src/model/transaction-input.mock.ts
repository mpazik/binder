import type { TransactionInput } from "./transaction-input.ts";
import { changesetInputForNewEntity } from "./changeset-input.ts";
import {
  mockProjectNode,
  mockTask1Node,
  mockTask1Uid,
  mockTask2Node,
} from "./node.mock.ts";
import { mockNodeSchemaRaw } from "./schema.mock.ts";
import {
  mockAuthor,
  mockCreatedTime,
  mockUpdatedTime,
} from "./transaction.mock.ts";

export const mockTransactionInitInput: TransactionInput = {
  author: mockAuthor,
  createdAt: mockCreatedTime,
  nodes: [
    changesetInputForNewEntity(mockTask1Node),
    changesetInputForNewEntity(mockProjectNode),
    changesetInputForNewEntity(mockTask2Node),
  ],
  configurations: [
    ...Object.values(mockNodeSchemaRaw.fields).map((field) =>
      changesetInputForNewEntity<"config">(field),
    ),
    ...Object.values(mockNodeSchemaRaw.types).map((type) =>
      changesetInputForNewEntity<"config">(type),
    ),
  ],
};

export const mockTransactionInputUpdate: TransactionInput = {
  author: mockAuthor,
  createdAt: mockUpdatedTime,
  nodes: [
    {
      $ref: mockTask1Uid,
      title: "Implement user authentication system",
      tags: [["insert", "completed", 1]],
    },
  ],
  configurations: [],
};
