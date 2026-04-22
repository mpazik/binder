import type { TransactionInput } from "./transaction-input.ts";
import { changesetInputForNewEntity } from "./changeset-input.ts";
import {
  mockProjectRecord,
  mockTask1Record,
  mockTask1Uid,
  mockTask2Record,
  mockTaskRecord1Updated,
} from "./record.mock.ts";
import { mockRecordSchemaRaw } from "./schema.mock.ts";
import { computeTextDiff } from "./text-diff.ts";
import {
  mockAuthor,
  mockCreatedTime,
  mockUpdatedTime,
} from "./transaction.mock.ts";

export const mockTransactionInitInput: TransactionInput = {
  author: mockAuthor,
  createdAt: mockCreatedTime,
  records: [
    changesetInputForNewEntity(mockTask1Record),
    changesetInputForNewEntity(mockProjectRecord),
    changesetInputForNewEntity(mockTask2Record),
  ],
  configs: [
    ...Object.values(mockRecordSchemaRaw.fields).map((field) =>
      changesetInputForNewEntity<"config">(field),
    ),
    ...Object.values(mockRecordSchemaRaw.types).map((type) =>
      changesetInputForNewEntity<"config">(type),
    ),
  ],
};

export const mockTransactionInputUpdate: TransactionInput = {
  author: mockAuthor,
  createdAt: mockUpdatedTime,
  records: [
    {
      $ref: mockTask1Uid,
      title: "Implement user authentication system",
      description: [
        "diff",
        computeTextDiff(
          mockTask1Record.description,
          mockTaskRecord1Updated.description,
        ),
      ],
      tags: [["insert", "completed", 1]],
    },
  ],
  configs: [],
};
