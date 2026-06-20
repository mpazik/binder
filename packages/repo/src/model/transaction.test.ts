import { describe, expect, it } from "bun:test";
import "@binder/utils/tests";
import { throwIfError } from "@binder/utils";
import {
  invertTransaction,
  parseTransaction,
  serializeTransaction,
  squashTransactions,
  type Transaction,
  type TransactionId,
  GENESIS_VERSION,
} from "./transaction.ts";
import {
  mockTransactionInit,
  mockTransactionUpdate,
} from "./transaction.mock.ts";
import { mockTask1Uid, mockTaskRecord1Updated } from "./record.mock.ts";
import { inverseChangeset } from "./changeset.ts";
import { mockRecordSchema } from "./schema.mock.ts";

import { coreConfigSchema } from "./config-schema.ts";

describe("serializeTransaction / parseTransaction", () => {
  it("round-trips a transaction", () => {
    const serialized = serializeTransaction(mockTransactionInit);
    const parsed = parseTransaction(serialized);
    expect(parsed).toBeOk();
    expect(throwIfError(parsed)).toEqual(mockTransactionInit);
  });

  it("omits empty records and configs", () => {
    const tx: Transaction = {
      ...mockTransactionInit,
      records: {},
      configs: {},
    };
    const serialized = serializeTransaction(tx);
    const obj = JSON.parse(serialized);
    expect(obj.records).toBeUndefined();
    expect(obj.configs).toBeUndefined();
  });

  it("parse defaults records and configs to {}", () => {
    const json = JSON.stringify({
      id: 1,
      hash: GENESIS_VERSION.hash,
      previous: GENESIS_VERSION.hash,
      author: "a",
      createdAt: "2025-01-01T00:00:00.000Z",
      tags: [],
    });
    const parsed = throwIfError(parseTransaction(json));
    expect(parsed.records).toEqual({});
    expect(parsed.configs).toEqual({});
  });

  it("parse returns Err on bad JSON", () => {
    const parsed = parseTransaction("not valid json");
    expect(parsed).toBeErr();
  });
});

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
          ...mockTaskRecord1Updated,
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
          ...mockTaskRecord1Updated,
          title: "Third",
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
