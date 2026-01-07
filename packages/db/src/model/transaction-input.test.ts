import { describe, expect, it } from "bun:test";
import { transactionToInput } from "./transaction-input.ts";
import {
  mockTransactionInit,
  mockTransactionUpdate,
} from "./transaction.mock.ts";
import {
  mockTransactionInitInput,
  mockTransactionInputUpdate,
} from "./transaction-input.mock.ts";

describe("transactionToInput", () => {
  it("converts init transaction to input format", () => {
    const input = transactionToInput(mockTransactionInit);
    expect(input).toMatchObject({
      author: mockTransactionInitInput.author,
      createdAt: mockTransactionInitInput.createdAt,
    });
    expect(input.nodes).toEqual(
      expect.arrayContaining(mockTransactionInitInput.nodes!),
    );
    expect(input.configurations).toEqual(
      expect.arrayContaining(mockTransactionInitInput.configurations!),
    );
  });

  it("converts update transaction to input format", () => {
    expect(transactionToInput(mockTransactionUpdate)).toEqual({
      author: mockTransactionInputUpdate.author,
      createdAt: mockTransactionInputUpdate.createdAt,
      nodes: mockTransactionInputUpdate.nodes,
    });
  });

  it("omits empty nodes and configurations", () => {
    expect(
      transactionToInput({
        ...mockTransactionUpdate,
        nodes: {},
        configurations: {},
      }),
    ).toEqual({
      author: mockTransactionUpdate.author,
      createdAt: mockTransactionUpdate.createdAt,
    });
  });
});
