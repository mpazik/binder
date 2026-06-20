import { beforeEach, describe, expect, it } from "bun:test";
import "@binder/utils/tests";
import {
  mockTransaction3,
  mockTransaction4,
  mockTransactionInit,
  mockTransactionInputUpdate,
  mockTransactionUpdate,
} from "@binder/repo/mocks";
import {
  type Database,
  GENESIS_VERSION,
  type KnowledgeGraph,
  type Transaction,
  type TransactionId,
} from "@binder/repo";
import { isErr, readLastLines, throwIfError } from "@binder/utils";
import { parseTransaction } from "@binder/repo";
import { TRANSACTION_LOG_FILE, UNDO_LOG_FILE } from "../../config.ts";
import {
  createMockRuntimeContextWithDb,
  mockConfig,
  mockLog,
  mockTelemetry,
  mockUi,
} from "../../runtime.mock.ts";
import type { RuntimeContextWithDb, GlobalOptions } from "../../runtime.ts";
import type { FileSystem } from "../../lib/filesystem.ts";
import { undoHandler, redoHandler } from "./commands.ts";

const applyTransactions = async (
  kg: KnowledgeGraph,
  transactions: Transaction[],
) => {
  for (const tx of transactions) {
    const result = await kg.apply(tx);
    if (isErr(result)) return result;
  }
  return { data: transactions };
};

describe("undo/redo commands", () => {
  const transactionLogPath = `${mockConfig.paths.data}/${TRANSACTION_LOG_FILE}`;
  const undoLogPath = `${mockConfig.paths.data}/${UNDO_LOG_FILE}`;
  let fs: FileSystem;
  let db: Database;
  let kg: KnowledgeGraph;
  let context: RuntimeContextWithDb;

  beforeEach(async () => {
    context = await createMockRuntimeContextWithDb();
    fs = context.fs;
    db = context.db;
    kg = context.kg;
  });

  const checkVersion = async (logTxId: TransactionId, kgTxId = logTxId) => {
    const version = throwIfError(await kg.version());
    expect(version.id).toBe(kgTxId);

    const mainLog = throwIfError(
      await readLastLines(fs, transactionLogPath, 1, parseTransaction),
    );
    expect((mainLog.at(-1) ?? GENESIS_VERSION).id).toBe(logTxId);
  };

  const undoCtx = (steps: number) => ({
    ...context,
    log: mockLog,
    ui: mockUi,
    telemetry: mockTelemetry,
    args: { steps } as { steps: number } & GlobalOptions,
  });

  const redoCtx = (steps: number) => ({
    ...context,
    log: mockLog,
    ui: mockUi,
    telemetry: mockTelemetry,
    args: { steps } as { steps: number } & GlobalOptions,
  });

  describe("undoHandler", () => {
    it("undoes transactions", async () => {
      throwIfError(
        await applyTransactions(kg, [
          mockTransactionInit,
          mockTransactionUpdate,
          mockTransaction3,
          mockTransaction4,
        ]),
      );

      const result = await undoHandler(undoCtx(2));

      expect(result).toBeOk();

      const version = throwIfError(await kg.version());
      expect(version.id).toBe(mockTransactionUpdate.id);

      const undoLog = throwIfError(
        await readLastLines(fs, undoLogPath, 10, parseTransaction),
      );
      expect(undoLog).toEqual([mockTransaction4, mockTransaction3]);

      const mainLog = throwIfError(
        await readLastLines(fs, transactionLogPath, 10, parseTransaction),
      );
      expect(mainLog).toEqual([mockTransactionInit, mockTransactionUpdate]);
    });

    it("errors on invalid count", async () => {
      const resultGenesis = await undoHandler(undoCtx(1));
      expect(resultGenesis).toBeErr();
      await checkVersion(GENESIS_VERSION.id);

      throwIfError(
        await applyTransactions(kg, [
          mockTransactionInit,
          mockTransactionUpdate,
        ]),
      );

      const resultOverflow = await undoHandler(undoCtx(5));
      expect(resultOverflow).toBeErr();
      await checkVersion(mockTransactionUpdate.id);
    });
  });

  describe("redoHandler", () => {
    it("redoes transactions", async () => {
      throwIfError(
        await applyTransactions(kg, [
          mockTransactionInit,
          mockTransactionUpdate,
          mockTransaction3,
          mockTransaction4,
        ]),
      );
      throwIfError(await undoHandler(undoCtx(2)));

      const result = await redoHandler(redoCtx(2));

      expect(result).toBeOk();

      const version = throwIfError(await kg.version());
      expect(version.id).toBe(mockTransaction4.id);

      const undoLog = throwIfError(
        await readLastLines(fs, undoLogPath, 10, parseTransaction),
      );
      expect(undoLog).toEqual([]);

      const mainLog = throwIfError(
        await readLastLines(fs, transactionLogPath, 10, parseTransaction),
      );
      expect(mainLog).toEqual([
        mockTransactionInit,
        mockTransactionUpdate,
        mockTransaction3,
        mockTransaction4,
      ]);
    });

    it("errors when insufficient undo history", async () => {
      const resultEmpty = await redoHandler(redoCtx(1));
      expect(resultEmpty).toBeErr();
      await checkVersion(GENESIS_VERSION.id);

      throwIfError(
        await applyTransactions(kg, [
          mockTransactionInit,
          mockTransactionUpdate,
        ]),
      );
      throwIfError(await undoHandler(undoCtx(1)));

      const resultOverflow = await redoHandler(redoCtx(5));
      expect(resultOverflow).toBeErr();
      await checkVersion(mockTransactionInit.id);
    });

    it("errors when version has changed since undo", async () => {
      throwIfError(
        await applyTransactions(kg, [
          mockTransactionInit,
          mockTransactionUpdate,
        ]),
      );
      throwIfError(await undoHandler(undoCtx(1)));
      throwIfError(await kg.update(mockTransactionInputUpdate));

      const result = await redoHandler(redoCtx(1));
      expect(result).toBeErr();
      await checkVersion(mockTransactionUpdate.id);
    });
  });
});
