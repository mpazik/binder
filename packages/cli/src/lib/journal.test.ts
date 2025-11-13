import { beforeEach, describe, expect, it } from "bun:test";
import "@binder/utils/tests";
import { type Transaction, type TransactionHash } from "@binder/db";
import {
  mockAuthor2,
  mockTransaction3,
  mockTransaction4,
  mockTransactionInit,
  mockTransactionUpdate,
} from "@binder/db/mocks";
import { throwIfError } from "@binder/utils";
import {
  clearLog,
  logTransactions,
  readLastTransactions,
  readTransactions,
  rehashLog,
  removeLastFromLog,
  verifyLog,
} from "./journal.ts";
import { createInMemoryFileSystem } from "./filesystem.mock.ts";

describe("journal", () => {
  const fs = createInMemoryFileSystem();
  const root = "/test-root";
  const path = `${root}/test-log.txt`;

  beforeEach(async () => {
    fs.rm(root, { recursive: true, force: true });
    fs.mkdir(root, { recursive: true });
    throwIfError(
      logTransactions(fs, path, [
        mockTransactionInit,
        mockTransactionUpdate,
        mockTransaction3,
        mockTransaction4,
      ]),
    );
  });

  it("logTransaction appends transaction as JSON with newline", async () => {
    const content = throwIfError(await fs.readFile(path));
    expect(content).toContain(JSON.stringify(mockTransactionInit) + "\n");
  });

  it("readLastTransactions returns empty array when file missing", async () => {
    const missingPath = `${root}/missing.txt`;
    const result = await readLastTransactions(fs, missingPath, 5);

    expect(throwIfError(result)).toEqual([]);
  });

  it("readLastTransactions reads last N transactions from single chunk", async () => {
    const result = await readLastTransactions(fs, path, 1);

    expect(throwIfError(result)).toEqual([mockTransaction4]);
  });

  it("readLastTransactions reads across multiple chunks", async () => {
    const result = await readLastTransactions(fs, path, 3);

    expect(throwIfError(result)).toEqual([
      mockTransactionUpdate,
      mockTransaction3,
      mockTransaction4,
    ]);
  });

  it("readLastTransactions returns all when count exceeds available", async () => {
    const result = await readLastTransactions(fs, path, 10);

    expect(throwIfError(result)).toEqual([
      mockTransactionInit,
      mockTransactionUpdate,
      mockTransaction3,
      mockTransaction4,
    ]);
  });

  it("removeLastFromLog removes N transactions", async () => {
    const result = await removeLastFromLog(fs, path, 1);

    expect(result).toBeOk();
    const remaining = throwIfError(await readLastTransactions(fs, path, 10));
    expect(remaining).toEqual([
      mockTransactionInit,
      mockTransactionUpdate,
      mockTransaction3,
    ]);
  });

  it("removeLastFromLog errors when count exceeds available", async () => {
    const result = await removeLastFromLog(fs, path, 5);

    expect(result).toBeErr();
  });

  it("clearLog clears file to empty string", async () => {
    const result = await clearLog(fs, path);

    throwIfError(result);
    const content = throwIfError(await fs.readFile(path));
    expect(content).toBe("");
  });

  describe("verifyLog", () => {
    const verifyPath = `${root}/verify-log.txt`;

    const checkVerify = async (
      txs: Transaction[] | string | undefined,
      expected: number | string,
      options?: { verifyIntegrity?: boolean },
    ) => {
      if (typeof txs === "string") {
        fs.writeFile(verifyPath, txs);
      } else if (txs) {
        throwIfError(logTransactions(fs, verifyPath, txs));
      }

      const result = await verifyLog(fs, verifyPath, options);

      if (typeof expected === "number") {
        expect(result).toBeOk();
        expect(throwIfError(result)).toEqual({ count: expected });
      } else {
        expect(result).toBeErr();
        expect(result).toEqual(
          expect.objectContaining({
            error: expect.objectContaining({ key: expected }),
          }),
        );
      }
    };

    it("returns count 0 when file does not exist", async () => {
      await checkVerify(undefined, 0);
    });

    it("returns valid for empty file", async () => {
      await checkVerify("", 0);
    });

    it("returns error for unparseable JSON", async () => {
      await checkVerify("invalid json\n", "parse-error");
    });

    it("returns error when first transaction does not point to genesis", async () => {
      await checkVerify(
        [
          {
            ...mockTransactionInit,
            previous: "wrong-previous-hash" as TransactionHash,
          },
        ],
        "chain-error",
      );
    });

    it("returns error when transaction chain is broken", async () => {
      await checkVerify(
        [
          mockTransactionInit,
          {
            ...mockTransactionUpdate,
            previous: "wrong-previous-hash" as TransactionHash,
          },
        ],
        "chain-error",
      );
    });

    it("validates chain without verifying hash integrity by default", async () => {
      await checkVerify(
        [
          mockTransactionInit,
          { ...mockTransactionUpdate, hash: "wrong" as TransactionHash },
        ],
        2,
      );
    });

    it("verifies hash integrity when option is set", async () => {
      await checkVerify([mockTransactionInit, mockTransactionUpdate], 2);
    });

    it("returns error when hash does not match with verifyIntegrity", async () => {
      await checkVerify(
        [
          {
            ...mockTransactionInit,
            hash: "wrong-hash" as TransactionHash,
          },
        ],
        "hash-mismatch",
        { verifyIntegrity: true },
      );
    });
  });

  describe("readTransactions", () => {
    it("reads last N transactions in newest-first order by default", async () => {
      const result = await readTransactions(fs, path, 2);

      expect(throwIfError(result)).toEqual([
        mockTransaction4,
        mockTransaction3,
      ]);
    });

    it("filters by author and returns in oldest-first order with asc", async () => {
      const result = await readTransactions(
        fs,
        path,
        10,
        { author: mockAuthor2 },
        "asc",
      );

      expect(throwIfError(result)).toEqual([
        mockTransaction3,
        mockTransaction4,
      ]);
    });
  });

  describe("rehashLog", () => {
    const rehashPath = `${root}/rehash-log.jsonl`;

    it("rehashes all transactions with correct chain", async () => {
      const badHash1 = "bad-hash-1" as TransactionHash;
      const transactionsWithBadHashes: Transaction[] = [
        {
          ...mockTransactionInit,
          hash: badHash1,
          previous: "bad-previous-1" as TransactionHash,
        },
        {
          ...mockTransactionUpdate,
          hash: "bad-hash-2" as TransactionHash,
          previous: badHash1,
        },
      ];
      throwIfError(logTransactions(fs, rehashPath, transactionsWithBadHashes));

      const result = await rehashLog(fs, rehashPath);

      expect(result).toBeOkWith({
        transactionsRehashed: 2,
        backupPath: expect.stringMatching(/rehash-log-.*\.jsonl\.bac$/),
      });

      const rehashedTransactions = throwIfError(
        await readTransactions(fs, rehashPath, 10, undefined, "asc"),
      );
      expect(rehashedTransactions).toEqual([
        mockTransactionInit,
        mockTransactionUpdate,
      ]);
    });
  });
});
