import { beforeEach, describe, expect, it } from "bun:test";
import "@binder/utils/tests";
import {
  GENESIS_VERSION,
  type Transaction,
  type TransactionHash,
  withHashTransaction,
} from "@binder/db";
import { mockTransactionInit, mockTransactionUpdate } from "@binder/db/mocks";
import { throwIfError } from "@binder/utils";
import {
  clearLog,
  logTransaction,
  readLastTransactions,
  removeLastFromLog,
  verifyLog,
} from "./journal.ts";
import { createInMemoryFileSystem } from "./filesystem.mock.ts";

describe("journal", () => {
  const fs = createInMemoryFileSystem();
  const root = "/test-root";
  const path = `${root}/test-log.txt`;

  const logTransactions = async (...txs: Transaction[]) => {
    for (const tx of txs) {
      throwIfError(await logTransaction(fs, path, tx));
    }
  };

  beforeEach(() => {
    fs.rm(root, { recursive: true, force: true });
    fs.mkdir(root, { recursive: true });
  });

  it("logTransaction appends transaction as JSON with newline", async () => {
    await logTransactions(mockTransactionInit);

    const content = throwIfError(await fs.readFile(path));
    expect(content).toBe(JSON.stringify(mockTransactionInit) + "\n");
  });

  it("readLastTransactions returns empty array when file missing", async () => {
    const result = await readLastTransactions(fs, path, 5);

    expect(throwIfError(result)).toEqual([]);
  });

  it("readLastTransactions reads last N transactions from single chunk", async () => {
    await logTransactions(mockTransactionInit, mockTransactionUpdate);

    const result = await readLastTransactions(fs, path, 1);

    expect(throwIfError(result)).toEqual([mockTransactionUpdate]);
  });

  it("readLastTransactions reads across multiple chunks", async () => {
    const transactions = Array.from({ length: 10 }, (_, i) => ({
      ...mockTransactionInit,
      id: i as any,
    }));

    await logTransactions(...transactions);

    const result = await readLastTransactions(fs, path, 6);

    expect(throwIfError(result)).toEqual(transactions.slice(-6));
  });

  it("readLastTransactions returns all when count exceeds available", async () => {
    await logTransactions(mockTransactionInit, mockTransactionUpdate);

    const result = await readLastTransactions(fs, path, 6);

    expect(throwIfError(result)).toEqual([
      mockTransactionInit,
      mockTransactionUpdate,
    ]);
  });

  it("removeLastFromLog removes N transactions", async () => {
    await logTransactions(mockTransactionInit, mockTransactionUpdate);

    const result = await removeLastFromLog(fs, path, 1);

    expect(result).toBeOk();
    const remaining = throwIfError(await readLastTransactions(fs, path, 10));
    expect(remaining).toEqual([mockTransactionInit]);
  });

  it("removeLastFromLog errors when count exceeds available", async () => {
    await logTransactions(mockTransactionInit);

    const result = await removeLastFromLog(fs, path, 5);

    expect(result).toBeErr();
  });

  it("clearLog clears file to empty string", async () => {
    await logTransactions(mockTransactionInit);

    const result = await clearLog(fs, path);

    throwIfError(result);
    const content = throwIfError(await fs.readFile(path));
    expect(content).toBe("");
  });

  describe("verifyLog", () => {
    const checkVerify = async (
      txs: Transaction[] | string | undefined,
      expected: number | string,
      options?: { verifyIntegrity?: boolean },
    ) => {
      if (typeof txs === "string") {
        fs.writeFile(path, txs);
      } else if (txs) {
        await logTransactions(...txs);
      }

      const result = await verifyLog(fs, path, options);

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

    it("returns error when file does not exist", async () => {
      await checkVerify(undefined, "file-not-found");
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
});
