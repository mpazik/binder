import { describe, expect, it } from "bun:test";
import {
  squashTransactions,
  type Transaction,
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

describe("squashTransactions", () => {
  it("squashes two transactions", async () => {
    const result = await squashTransactions([
      mockTransactionInit,
      mockTransactionUpdate,
    ]);

    expect(result).toEqual({
      ...mockTransactionInit,
      author: mockTransactionUpdate.author,
      createdAt: mockTransactionUpdate.createdAt,
      hash: expect.any(String),
      nodes: {
        ...mockTransactionInit.nodes,
        [mockTask1Uid]: {
          ...mockTask1Node,
          title: {
            op: "set",
            value: mockTaskNode1Updated.title,
          },
          tags: {
            op: "set",
            value: mockTaskNode1Updated.tags,
          },
        },
      },
    });
  });

  it("squashes changes that cancel out", async () => {
    const result = await squashTransactions([
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
    ]);

    expect(result.nodes[mockTask1Uid]).toEqual({});
  });

  it("squashes multiple transactions", async () => {
    const result = await squashTransactions([
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
    ]);

    expect(result).toEqual({
      ...mockTransactionInit,
      author: mockTransactionUpdate.author,
      createdAt: mockTransactionUpdate.createdAt,
      hash: expect.any(String),
      nodes: {
        ...mockTransactionInit.nodes,
        [mockTask1Uid]: {
          ...mockTask1Node,
          title: {
            op: "set",
            value: "Third",
          },
          tags: {
            op: "set",
            value: mockTaskNode1Updated.tags,
          },
        },
      },
    });
  });
});
