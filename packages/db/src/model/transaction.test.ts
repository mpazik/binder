import { describe, expect, it } from "bun:test";
import {
  invertTransaction,
  squashTransactions,
  type TransactionId,
} from "./transaction.ts";
import {
  mockTransactionInit,
  mockTransactionUpdate,
} from "./transaction.mock.ts";
import {
  mockTask1Record,
  mockTask1Uid,
  mockTaskRecord1Updated,
} from "./record.mock.ts";
import { inverseChangeset } from "./changeset.ts";
import { mockRecordSchema } from "./schema.mock.ts";

import { coreConfigSchema } from "./system.ts";

describe("squashTransactions", () => {
  it("squashes two transactions", async () => {
    const result = await squashTransactions(
      [mockTransactionInit, mockTransactionUpdate],
      mockRecordSchema,
      coreConfigSchema,
    );

    expect(result).toEqual({
      ...mockTransactionInit,
      author: mockTransactionUpdate.author,
      createdAt: mockTransactionUpdate.createdAt,
      hash: expect.any(String),
      records: {
        ...mockTransactionInit.records,
        [mockTask1Uid]: {
          ...mockTask1Record,
          title: mockTaskRecord1Updated.title,
          tags: mockTaskRecord1Updated.tags,
        },
      },
    });
  });

  it("squashes changes that cancel out", async () => {
    const result = await squashTransactions(
      [
        mockTransactionUpdate,
        {
          ...mockTransactionUpdate,
          previous: mockTransactionUpdate.hash,
          records: {
            [mockTask1Uid]: inverseChangeset(
              mockTransactionUpdate.records[mockTask1Uid],
            ),
          },
        },
      ],
      mockRecordSchema,
      coreConfigSchema,
    );

    expect(result.records[mockTask1Uid]).toBeUndefined();
  });

  it("squashes multiple transactions", async () => {
    const result = await squashTransactions(
      [
        mockTransactionInit,
        mockTransactionUpdate,
        {
          ...mockTransactionUpdate,
          id: 3 as TransactionId,
          previous: mockTransactionUpdate.hash,
          records: {
            [mockTask1Uid]: {
              title: ["set", "Third", mockTaskRecord1Updated.title],
            },
          },
        },
      ],
      mockRecordSchema,
      coreConfigSchema,
    );

    expect(result).toEqual({
      ...mockTransactionInit,
      author: mockTransactionUpdate.author,
      createdAt: mockTransactionUpdate.createdAt,
      hash: expect.any(String),
      records: {
        ...mockTransactionInit.records,
        [mockTask1Uid]: {
          ...mockTask1Record,
          title: "Third",
          tags: mockTaskRecord1Updated.tags,
        },
      },
    });
  });
});

describe("transactionInvert", () => {
  it("inverts transaction records and configs", () => {
    const result = invertTransaction(mockTransactionUpdate);

    expect(result.records[mockTask1Uid]).toEqual(
      inverseChangeset(mockTransactionUpdate.records[mockTask1Uid]),
    );
    expect(result.configs).toEqual({});
  });

  it("double inversion returns original changesets", () => {
    const inverted = invertTransaction(mockTransactionInit);
    const doubleInverted = invertTransaction(inverted);

    expect(doubleInverted).toStrictEqual(mockTransactionInit);
  });
});
