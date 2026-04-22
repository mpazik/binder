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
    expect(input.records).toEqual(
      expect.arrayContaining(mockTransactionInitInput.records!),
    );
    expect(input.configs).toEqual(
      expect.arrayContaining(mockTransactionInitInput.configs!),
    );
  });

  it("converts update transaction to input format", () => {
    expect(transactionToInput(mockTransactionUpdate)).toEqual({
      author: mockTransactionInputUpdate.author,
      createdAt: mockTransactionInputUpdate.createdAt,
      records: mockTransactionInputUpdate.records,
    });
  });

  it("omits empty records and configs", () => {
    expect(
      transactionToInput({
        ...mockTransactionUpdate,
        records: {},
        configs: {},
      }),
    ).toEqual({
      author: mockTransactionUpdate.author,
      createdAt: mockTransactionUpdate.createdAt,
    });
  });
});
