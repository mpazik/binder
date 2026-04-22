import { beforeEach, describe, expect, it } from "bun:test";
import "@binder/utils/tests";
import { type Transaction, type TransactionHash } from "@binder/repo";
import {
  mockAuthor2,
  mockTransaction3,
  mockTransaction4,
  mockTransactionInit,
  mockTransactionUpdate,
} from "@binder/repo/mocks";
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
    await fs.rm(root, { recursive: true, force: true });
    await fs.mkdir(root, { recursive: true });
    throwIfError(
      await logTransactions(fs, path, [
        mockTransactionInit,
        mockTransactionUpdate,
        mockTransaction3,
        mockTransaction4,
      ]),
    );
  });

  describe("logTransactions", () => {
    it("appends transaction as JSON with newline", async () => {
      const content = throwIfError(await fs.readFile(path));
      expect(content).toContain(JSON.stringify(mockTransactionInit) + "\n");
    });
  });

  describe("readLastTransactions", () => {
    const check = async (count: number, expected: Transaction[]) => {
      const result = await readLastTransactions(fs, path, count);
      expect(throwIfError(result)).toEqual(expected);
    };

    it("returns empty array when file missing", async () => {
      const result = await readLastTransactions(fs, `${root}/missing.txt`, 5);
      expect(throwIfError(result)).toEqual([]);
    });

    it("reads last N from single chunk", async () => {
      await check(1, [mockTransaction4]);
    });

    it("reads across multiple chunks", async () => {
      await check(3, [
        mockTransactionUpdate,
        mockTransaction3,
        mockTransaction4,
      ]);
    });

    it("returns all when count exceeds available", async () => {
      await check(10, [
        mockTransactionInit,
        mockTransactionUpdate,
        mockTransaction3,
        mockTransaction4,
      ]);
    });
  });

  describe("removeLastFromLog", () => {
    it("removes N transactions", async () => {
      const result = await removeLastFromLog(fs, path, 1);

      expect(result).toBeOk();
      const remaining = throwIfError(await readLastTransactions(fs, path, 10));
      expect(remaining).toEqual([
        mockTransactionInit,
        mockTransactionUpdate,
        mockTransaction3,
      ]);
    });

    it("errors when count exceeds available", async () => {
      expect(await removeLastFromLog(fs, path, 5)).toBeErr();
    });
  });

  describe("clearLog", () => {
    it("clears file to empty string", async () => {
      throwIfError(await clearLog(fs, path));
      const content = throwIfError(await fs.readFile(path));
      expect(content).toBe("");
    });
  });

  describe("verifyLog", () => {
    const verifyPath = `${root}/verify-log.txt`;

    const checkVerify = async (
      txs: Transaction[] | string | undefined,
      expected: number | string,
      options?: { verifyIntegrity?: boolean },
    ) => {
      if (typeof txs === "string") {
        await fs.writeFile(verifyPath, txs);
      } else if (txs) {
        throwIfError(await logTransactions(fs, verifyPath, txs));
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
    const check = async (
      count: number,
      expected: Transaction[],
      opts?: { filters?: { author?: string }; order?: "asc" | "desc" },
    ) => {
      const result = await readTransactions(
        fs,
        path,
        count,
        opts?.filters ?? {},
        opts?.order,
      );
      expect(throwIfError(result)).toEqual(expected);
    };

    it("reads last N in newest-first order by default", async () => {
      await check(2, [mockTransaction4, mockTransaction3]);
    });

    it("reads first N in oldest-first order with asc", async () => {
      await check(2, [mockTransactionInit, mockTransactionUpdate], {
        order: "asc",
      });
    });

    it("reads all in oldest-first order with asc", async () => {
      await check(
        10,
        [
          mockTransactionInit,
          mockTransactionUpdate,
          mockTransaction3,
          mockTransaction4,
        ],
        { order: "asc" },
      );
    });

    it("reads all in newest-first order with desc", async () => {
      await check(
        10,
        [
          mockTransaction4,
          mockTransaction3,
          mockTransactionUpdate,
          mockTransactionInit,
        ],
        { order: "desc" },
      );
    });

    it("filters by author with desc order", async () => {
      await check(10, [mockTransaction4, mockTransaction3], {
        filters: { author: mockAuthor2 },
        order: "desc",
      });
    });

    it("filters by author with asc order", async () => {
      await check(10, [mockTransaction3, mockTransaction4], {
        filters: { author: mockAuthor2 },
        order: "asc",
      });
    });

    it("returns empty array for count 0", async () => {
      await check(0, []);
    });
  });

  describe("rehashLog", () => {
    const rehashPath = `${root}/rehash-log.jsonl`;

    it("rehashes all transactions with correct chain", async () => {
      const badHash1 = "bad-hash-1" as TransactionHash;
      throwIfError(
        await logTransactions(fs, rehashPath, [
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
        ]),
      );

      const result = await rehashLog(fs, rehashPath);

      expect(result).toBeOkWith({
        transactionsRehashed: 2,
        backupPath: expect.stringMatching(/rehash-log-.*\.jsonl\.bac$/),
      });
      expect(
        throwIfError(
          await readTransactions(fs, rehashPath, 10, undefined, "asc"),
        ),
      ).toEqual([mockTransactionInit, mockTransactionUpdate]);
    });

    it("rehashes correctly when started with empty record schema", async () => {
      throwIfError(
        await logTransactions(fs, rehashPath, [
          mockTransactionInit,
          mockTransactionUpdate,
        ]),
      );

      const result = await rehashLog(fs, rehashPath);

      expect(result).toBeOkWith({
        transactionsRehashed: 2,
        backupPath: expect.stringMatching(/rehash-log-.*\.jsonl\.bac$/),
      });
      expect(
        throwIfError(
          await readTransactions(fs, rehashPath, 10, undefined, "asc"),
        ),
      ).toEqual([mockTransactionInit, mockTransactionUpdate]);
    });
  });
});
