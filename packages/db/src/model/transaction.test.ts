import { describe, expect, it } from "bun:test";
import {
  squashTransactions,
  invertTransaction,
  type TransactionId,
} from "./transaction.ts";
import {
  mockTransactionInit,
  mockTransactionUpdate,
} from "./transaction.mock.ts";
import {
  mockTask1Node,
  mockTask1Uid,
  mockTaskNode1Updated,
} from "./node.mock.ts";
import { inverseChangeset } from "./changeset.ts";
import { mockNodeSchema } from "./schema.mock.ts";
import { configSchema } from "./schema.ts";

describe("squashTransactions", () => {
  it("squashes two transactions", async () => {
    const result = await squashTransactions(
      [mockTransactionInit, mockTransactionUpdate],
      mockNodeSchema,
      configSchema,
    );

    expect(result).toEqual({
      ...mockTransactionInit,
      author: mockTransactionUpdate.author,
      createdAt: mockTransactionUpdate.createdAt,
      hash: expect.any(String),
      nodes: {
        ...mockTransactionInit.nodes,
        [mockTask1Uid]: {
          ...mockTask1Node,
          title: mockTaskNode1Updated.title,
          tags: mockTaskNode1Updated.tags,
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
          nodes: {
            [mockTask1Uid]: inverseChangeset(
              mockTransactionUpdate.nodes[mockTask1Uid],
            ),
          },
        },
      ],
      mockNodeSchema,
      configSchema,
    );

    expect(result.nodes[mockTask1Uid]).toBeUndefined();
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
          nodes: {
            [mockTask1Uid]: {
              title: {
                op: "set",
                previous: mockTaskNode1Updated.title,
                value: "Third",
              },
            },
          },
        },
      ],
      mockNodeSchema,
      configSchema,
    );

    expect(result).toEqual({
      ...mockTransactionInit,
      author: mockTransactionUpdate.author,
      createdAt: mockTransactionUpdate.createdAt,
      hash: expect.any(String),
      nodes: {
        ...mockTransactionInit.nodes,
        [mockTask1Uid]: {
          ...mockTask1Node,
          title: "Third",
          tags: mockTaskNode1Updated.tags,
        },
      },
    });
  });
});

describe("transactionInvert", () => {
  it("inverts transaction nodes and configurations", () => {
    const result = invertTransaction(mockTransactionUpdate);

    expect(result.nodes[mockTask1Uid]).toEqual(
      inverseChangeset(mockTransactionUpdate.nodes[mockTask1Uid]),
    );
    expect(result.configurations).toEqual({});
  });

  it("double inversion returns original changesets", () => {
    const inverted = invertTransaction(mockTransactionInit);
    const doubleInverted = invertTransaction(inverted);

    expect(doubleInverted).toStrictEqual(mockTransactionInit);
  });
});
