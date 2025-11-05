import { beforeEach, describe, expect, it } from "bun:test";
import "@binder/utils/tests";
import { mockTransactionInit, mockTransactionUpdate } from "@binder/db/mocks";
import { throwIfError } from "@binder/utils";
import {
  clearLog,
  logTransaction,
  readLastTransactions,
  removeLastFromLog,
} from "./journal.ts";
import { createInMemoryFileSystem } from "./filesystem.mock.ts";

describe("journal", () => {
  const fs = createInMemoryFileSystem();
  const root = "/test-root";
  const path = `${root}/test-log.txt`;

  beforeEach(() => {
    fs.rm(root, { recursive: true, force: true });
    fs.mkdir(root, { recursive: true });
  });

  it("logTransaction appends transaction as JSON with newline", async () => {
    throwIfError(await logTransaction(fs, path, mockTransactionInit));

    const content = throwIfError(await fs.readFile(path));
    expect(content).toBe(JSON.stringify(mockTransactionInit) + "\n");
  });

  it("readLastTransactions returns empty array when file missing", async () => {
    const result = await readLastTransactions(fs, path, 5);

    expect(throwIfError(result)).toEqual([]);
  });

  it("readLastTransactions reads last N transactions from single chunk", async () => {
    throwIfError(await logTransaction(fs, path, mockTransactionInit));
    throwIfError(await logTransaction(fs, path, mockTransactionUpdate));

    const result = await readLastTransactions(fs, path, 1);

    expect(throwIfError(result)).toEqual([mockTransactionUpdate]);
  });

  it("readLastTransactions reads across multiple chunks", async () => {
    const transactions = Array.from({ length: 10 }, (_, i) => ({
      ...mockTransactionInit,
      id: i as any,
    }));

    for (const tx of transactions) {
      throwIfError(await logTransaction(fs, path, tx));
    }

    const result = await readLastTransactions(fs, path, 6);

    expect(throwIfError(result)).toEqual(transactions.slice(-6));
  });

  it("readLastTransactions returns all when count exceeds available", async () => {
    throwIfError(await logTransaction(fs, path, mockTransactionInit));
    throwIfError(await logTransaction(fs, path, mockTransactionUpdate));

    const result = await readLastTransactions(fs, path, 6);

    expect(throwIfError(result)).toEqual([
      mockTransactionInit,
      mockTransactionUpdate,
    ]);
  });

  it("removeLastFromLog removes N transactions", async () => {
    throwIfError(await logTransaction(fs, path, mockTransactionInit));
    throwIfError(await logTransaction(fs, path, mockTransactionUpdate));

    const result = await removeLastFromLog(fs, path, 1);

    expect(result).toBeOk();
    const remaining = throwIfError(await readLastTransactions(fs, path, 10));
    expect(remaining).toEqual([mockTransactionInit]);
  });

  it("removeLastFromLog errors when count exceeds available", async () => {
    throwIfError(await logTransaction(fs, path, mockTransactionInit));

    const result = await removeLastFromLog(fs, path, 5);

    expect(result).toBeErr();
  });

  it("clearLog clears file to empty string", async () => {
    throwIfError(await logTransaction(fs, path, mockTransactionInit));

    const result = await clearLog(fs, path);

    throwIfError(result);
    const content = throwIfError(await fs.readFile(path));
    expect(content).toBe("");
  });
});
