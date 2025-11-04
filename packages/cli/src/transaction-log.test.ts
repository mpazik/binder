import { describe, it, expect, beforeEach } from "bun:test";
import "@binder/utils/tests";
import { mockTransactionInit, mockTransactionUpdate } from "@binder/db/mocks";
import { throwIfError } from "@binder/utils";
import {
  logTransaction,
  readLastTransactions,
  removeLastFromLog,
  clearTransactionLog,
} from "./transaction-log.ts";
import { createInMemoryFileSystem } from "./lib/filesystem.mock.ts";

describe("transaction-log", () => {
  const fs = createInMemoryFileSystem();
  const root = "/test-root";
  const file = "test-log.txt";
  const path = `${root}/${file}`;

  beforeEach(() => {
    fs.rm(root, { recursive: true, force: true });
    fs.mkdir(root, { recursive: true });
  });

  it("logTransaction appends transaction as JSON with newline", async () => {
    throwIfError(await logTransaction(fs, root, mockTransactionInit, file));

    const content = throwIfError(await fs.readFile(path));
    expect(content).toBe(JSON.stringify(mockTransactionInit) + "\n");
  });

  it("readLastTransactions returns empty array when file missing", async () => {
    const result = await readLastTransactions(fs, root, 5, file);

    expect(throwIfError(result)).toEqual([]);
  });

  it("readLastTransactions reads last N transactions from single chunk", async () => {
    throwIfError(await logTransaction(fs, root, mockTransactionInit, file));
    throwIfError(await logTransaction(fs, root, mockTransactionUpdate, file));

    const result = await readLastTransactions(fs, root, 1, file);

    expect(throwIfError(result)).toEqual([mockTransactionUpdate]);
  });

  it("readLastTransactions reads across multiple chunks", async () => {
    const transactions = Array.from({ length: 10 }, (_, i) => ({
      ...mockTransactionInit,
      id: i as any,
    }));

    for (const tx of transactions) {
      throwIfError(await logTransaction(fs, root, tx, file));
    }

    const result = await readLastTransactions(fs, root, 6, file);

    expect(throwIfError(result)).toEqual(transactions.slice(-6));
  });

  it("readLastTransactions returns all when count exceeds available", async () => {
    throwIfError(await logTransaction(fs, root, mockTransactionInit, file));
    throwIfError(await logTransaction(fs, root, mockTransactionUpdate, file));

    const result = await readLastTransactions(fs, root, 6, file);

    expect(throwIfError(result)).toEqual([
      mockTransactionInit,
      mockTransactionUpdate,
    ]);
  });

  it("removeLastFromLog removes N transactions", async () => {
    throwIfError(await logTransaction(fs, root, mockTransactionInit, file));
    throwIfError(await logTransaction(fs, root, mockTransactionUpdate, file));

    const result = await removeLastFromLog(fs, root, 1, file);

    expect(result).toBeOk();
    const remaining = throwIfError(
      await readLastTransactions(fs, root, 10, file),
    );
    expect(remaining).toEqual([mockTransactionInit]);
  });

  it("removeLastFromLog errors when count exceeds available", async () => {
    throwIfError(await logTransaction(fs, root, mockTransactionInit, file));

    const result = await removeLastFromLog(fs, root, 5, file);

    expect(result).toBeErr();
  });

  it("clearTransactionLog clears file to empty string", async () => {
    throwIfError(await logTransaction(fs, root, mockTransactionInit, file));

    const result = await clearTransactionLog(fs, root, file);

    throwIfError(result);
    const content = throwIfError(await fs.readFile(path));
    expect(content).toBe("");
  });
});
