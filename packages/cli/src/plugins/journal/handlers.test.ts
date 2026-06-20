import { beforeEach, describe, expect, it } from "bun:test";
import "@binder/utils/tests";
import {
  mockTransaction3,
  mockTransaction4,
  mockTransactionInit,
  mockTransactionUpdate,
} from "@binder/repo/mocks";
import { serializeTransaction, parseTransaction } from "@binder/repo";
import { appendLines, readLastLines, throwIfError } from "@binder/utils";
import { createInMemoryFileSystem } from "../../lib/filesystem.mock.ts";
import { journalOnCommit, journalOnRollback } from "./handlers.ts";

describe("journal handlers", () => {
  const fs = createInMemoryFileSystem();
  const root = "/test-root";
  const txPath = `${root}/transactions.jsonl`;

  const readTxLog = async () =>
    throwIfError(await readLastLines(fs, txPath, 100, parseTransaction));

  beforeEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.mkdir(root, { recursive: true });
  });

  describe("journalOnCommit", () => {
    it("appends when tx.previous matches the tail hash", async () => {
      throwIfError(
        await appendLines(
          fs,
          txPath,
          [mockTransactionInit],
          serializeTransaction,
        ),
      );

      throwIfError(await journalOnCommit(fs, txPath, mockTransactionUpdate));

      expect(await readTxLog()).toEqual([
        mockTransactionInit,
        mockTransactionUpdate,
      ]);
    });

    it("appends the genesis-chained tx to an empty log", async () => {
      throwIfError(await journalOnCommit(fs, txPath, mockTransactionInit));

      expect(await readTxLog()).toEqual([mockTransactionInit]);
    });

    it("is a no-op when the tx is already the tail (idempotent)", async () => {
      throwIfError(
        await appendLines(
          fs,
          txPath,
          [mockTransactionInit, mockTransactionUpdate],
          serializeTransaction,
        ),
      );

      throwIfError(await journalOnCommit(fs, txPath, mockTransactionUpdate));

      expect(await readTxLog()).toEqual([
        mockTransactionInit,
        mockTransactionUpdate,
      ]);
    });
  });

  describe("journalOnRollback", () => {
    beforeEach(async () => {
      throwIfError(
        await appendLines(
          fs,
          txPath,
          [
            mockTransactionInit,
            mockTransactionUpdate,
            mockTransaction3,
            mockTransaction4,
          ],
          serializeTransaction,
        ),
      );
    });

    it("trims the matching tail from the tx-log", async () => {
      throwIfError(
        await journalOnRollback(fs, txPath, [
          mockTransaction4,
          mockTransaction3,
        ]),
      );

      expect(await readTxLog()).toEqual([
        mockTransactionInit,
        mockTransactionUpdate,
      ]);
    });

    it("is a no-op when the reverted tx is not the tail (db-only)", async () => {
      const dbOnly = { ...mockTransaction4, hash: "different-hash" as never };

      throwIfError(await journalOnRollback(fs, txPath, [dbOnly]));

      expect(await readTxLog()).toEqual([
        mockTransactionInit,
        mockTransactionUpdate,
        mockTransaction3,
        mockTransaction4,
      ]);
    });

    it("stops at the first non-matching tx", async () => {
      const dbOnly = { ...mockTransaction3, hash: "different-hash" as never };

      throwIfError(
        await journalOnRollback(fs, txPath, [mockTransaction4, dbOnly]),
      );

      expect(await readTxLog()).toEqual([
        mockTransactionInit,
        mockTransactionUpdate,
        mockTransaction3,
      ]);
    });
  });
});
