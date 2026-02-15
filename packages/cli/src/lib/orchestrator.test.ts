import { beforeEach, describe, expect, it } from "bun:test";
import "@binder/utils/tests";
import {
  mockRecordSchema,
  mockTransaction3,
  mockTransaction4,
  mockTransactionInit,
  mockTransactionUpdate,
} from "@binder/db/mocks";
import {
  coreConfigSchema,
  type Database,
  GENESIS_VERSION,
  type KnowledgeGraph,
  openKnowledgeGraph,
  type Transaction,
  type TransactionId,
  withHashTransaction,
} from "@binder/db";
import { throwIfError } from "@binder/utils";
import { TRANSACTION_LOG_FILE, UNDO_LOG_FILE } from "../config.ts";
import { createMockRuntimeContextWithDb, mockConfig } from "../runtime.mock.ts";
import type { RuntimeContextWithDb } from "../runtime.ts";
import {
  applyTransactions,
  redoTransactions,
  repairDbFromLog,
  squashTransactions,
  undoTransactions,
  type VerifySync,
  verifySync,
} from "./orchestrator.ts";
import {
  logTransactions,
  readLastTransactions,
  removeLastFromLog,
} from "./journal.ts";
import type { FileSystem } from "./filesystem.ts";

describe("orchestrator", () => {
  const binderPath = mockConfig.paths.binder;
  const transactionLogPath = `${mockConfig.paths.binder}/${TRANSACTION_LOG_FILE}`;
  const undoLogPath = `${mockConfig.paths.binder}/${UNDO_LOG_FILE}`;
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
      await readLastTransactions(fs, transactionLogPath, 1),
    );
    expect((mainLog.at(-1) ?? GENESIS_VERSION).id).toBe(logTxId);
  };

  describe("verifySync", () => {
    const checkSync = async (
      logTxs: Transaction[],
      dbTxs: Transaction[],
      expected: VerifySync,
    ) => {
      const kg = openKnowledgeGraph(db);
      for (const tx of dbTxs) throwIfError(await kg.apply(tx));
      throwIfError(await logTransactions(fs, transactionLogPath, logTxs));

      const result = await verifySync(fs, kg, binderPath);
      const sync = throwIfError(result);
      expect(sync).toEqual(expected);
    };

    it("returns all db transactions when log does not exist", async () => {
      await checkSync([], [mockTransactionInit, mockTransactionUpdate], {
        dbOnlyTransactions: [mockTransactionInit, mockTransactionUpdate],
        logOnlyTransactions: [],
        lastSyncedId: GENESIS_VERSION.id,
      });
    });

    it("returns zero when db and log are in sync", async () => {
      await checkSync(
        [mockTransactionInit, mockTransactionUpdate],
        [mockTransactionInit, mockTransactionUpdate],
        {
          dbOnlyTransactions: [],
          logOnlyTransactions: [],
          lastSyncedId: mockTransactionUpdate.id,
        },
      );
    });

    it("returns log ahead when log has more transactions", async () => {
      await checkSync(
        [mockTransactionInit, mockTransactionUpdate],
        [mockTransactionInit],
        {
          dbOnlyTransactions: [],
          logOnlyTransactions: [mockTransactionUpdate],
          lastSyncedId: mockTransactionInit.id,
        },
      );
    });

    it("detects divergence when hashes differ", async () => {
      const divergedTx = await withHashTransaction(
        coreConfigSchema,
        mockRecordSchema,
        {
          ...mockTransactionUpdate,
          author: "different-user",
        },
        mockTransactionUpdate.id,
      );

      await checkSync(
        [mockTransactionInit, divergedTx],
        [mockTransactionInit, mockTransactionUpdate],
        {
          dbOnlyTransactions: [mockTransactionUpdate],
          logOnlyTransactions: [divergedTx],
          lastSyncedId: mockTransactionInit.id,
        },
      );
    });

    it("handles empty database", async () => {
      await checkSync([mockTransactionInit, mockTransactionUpdate], [], {
        dbOnlyTransactions: [],
        logOnlyTransactions: [mockTransactionInit, mockTransactionUpdate],
        lastSyncedId: GENESIS_VERSION.id,
      });
    });
  });

  describe("repairSync", () => {
    const checkRepair = async (
      logTxs: Transaction[],
      dbTxs: Transaction[],
      loggedDbTxs: Transaction[] = [],
    ) => {
      const kg = openKnowledgeGraph(db);
      for (const tx of dbTxs) throwIfError(await kg.apply(tx));
      throwIfError(await logTransactions(fs, transactionLogPath, logTxs));

      const result = await repairDbFromLog(context);
      expect(result).toBeOk();

      const { dbTransactionsPath } = throwIfError(result);

      const version = throwIfError(await kg.version());
      expect(version.hash).toBe(logTxs.at(-1)?.hash ?? GENESIS_VERSION.hash);

      if (loggedDbTxs.length === 0) {
        expect(dbTransactionsPath).toBeUndefined();
      } else {
        expect(dbTransactionsPath).toMatch(
          /repair-db-transactions-.*\.jsonl\.bac$/,
        );
        const snapshotTxs = throwIfError(
          await readLastTransactions(
            fs,
            dbTransactionsPath!,
            loggedDbTxs.length,
          ),
        );
        expect(snapshotTxs).toEqual(loggedDbTxs);
      }
    };

    it("does nothing when db and log are in sync", async () => {
      await checkRepair(
        [mockTransactionInit, mockTransactionUpdate],
        [mockTransactionInit, mockTransactionUpdate],
      );
    });

    it("applies missing transactions from log to db", async () => {
      await checkRepair(
        [mockTransactionInit, mockTransactionUpdate],
        [mockTransactionInit],
      );
    });

    it("rolls back extra transactions from db", async () => {
      await checkRepair(
        [mockTransactionInit],
        [mockTransactionInit, mockTransactionUpdate],
        [mockTransactionUpdate],
      );
    });

    it("handles divergence by rolling back and applying", async () => {
      await checkRepair(
        [
          mockTransactionInit,
          await withHashTransaction(
            coreConfigSchema,
            mockRecordSchema,
            {
              ...mockTransactionUpdate,
              author: "different-user",
            },
            mockTransactionUpdate.id,
          ),
        ],
        [mockTransactionInit, mockTransactionUpdate],
        [mockTransactionUpdate],
      );
    });
  });

  describe("applyTransactions", () => {
    it("applies transactions to db and logs them", async () => {
      const result = await applyTransactions(kg, [
        mockTransactionInit,
        mockTransactionUpdate,
      ]);

      expect(result).toBeOk();
      expect(throwIfError(result)).toEqual([
        mockTransactionInit,
        mockTransactionUpdate,
      ]);

      const version = throwIfError(await kg.version());
      expect(version.id).toBe(mockTransactionUpdate.id);

      const mainLog = throwIfError(
        await readLastTransactions(fs, transactionLogPath, 10),
      );
      expect(mainLog).toEqual([mockTransactionInit, mockTransactionUpdate]);
    });

    it("clears undo log when applying new transactions", async () => {
      throwIfError(
        await applyTransactions(kg, [
          mockTransactionInit,
          mockTransactionUpdate,
        ]),
      );
      throwIfError(await undoTransactions(context, 1));

      const undoLogBefore = throwIfError(
        await readLastTransactions(fs, undoLogPath, 10),
      );
      expect(undoLogBefore).toEqual([mockTransactionUpdate]);

      throwIfError(await applyTransactions(kg, [mockTransaction3]));

      const undoLogAfter = throwIfError(
        await readLastTransactions(fs, undoLogPath, 10),
      );
      expect(undoLogAfter).toEqual([]);
    });
  });

  describe("undoTransactions", () => {
    it("undoes transactions", async () => {
      throwIfError(
        await applyTransactions(kg, [
          mockTransactionInit,
          mockTransactionUpdate,
          mockTransaction3,
          mockTransaction4,
        ]),
      );

      const result = await undoTransactions(context, 2);

      expect(result).toBeOk();
      expect(throwIfError(result)).toEqual([
        mockTransaction4,
        mockTransaction3,
      ]);

      const version = throwIfError(await kg.version());
      expect(version.id).toBe(mockTransactionUpdate.id);

      const undoLog = throwIfError(
        await readLastTransactions(fs, undoLogPath, 10),
      );
      expect(undoLog).toEqual([mockTransaction4, mockTransaction3]);

      const mainLog = throwIfError(
        await readLastTransactions(fs, transactionLogPath, 10),
      );
      expect(mainLog).toEqual([mockTransactionInit, mockTransactionUpdate]);
    });

    it("errors on invalid count", async () => {
      const resultGenesis = await undoTransactions(context, 1);
      expect(resultGenesis).toBeErr();
      await checkVersion(GENESIS_VERSION.id);

      throwIfError(
        await applyTransactions(kg, [
          mockTransactionInit,
          mockTransactionUpdate,
        ]),
      );

      const resultOverflow = await undoTransactions(context, 5);
      expect(resultOverflow).toBeErr();
      await checkVersion(mockTransactionUpdate.id);
    });
  });

  describe("redoTransactions", () => {
    it("redoes transactions", async () => {
      throwIfError(
        await applyTransactions(kg, [
          mockTransactionInit,
          mockTransactionUpdate,
          mockTransaction3,
          mockTransaction4,
        ]),
      );
      throwIfError(await undoTransactions(context, 2));

      const result = await redoTransactions(context, 2);

      expect(result).toBeOk();
      expect(throwIfError(result)).toEqual([
        mockTransaction3,
        mockTransaction4,
      ]);

      const version = throwIfError(await kg.version());
      expect(version.id).toBe(mockTransaction4.id);

      const undoLog = throwIfError(
        await readLastTransactions(fs, undoLogPath, 10),
      );
      expect(undoLog).toEqual([]);

      const mainLog = throwIfError(
        await readLastTransactions(fs, transactionLogPath, 10),
      );
      expect(mainLog).toEqual([
        mockTransactionInit,
        mockTransactionUpdate,
        mockTransaction3,
        mockTransaction4,
      ]);
    });

    it("errors when insufficient undo history", async () => {
      const resultEmpty = await redoTransactions(context, 1);
      expect(resultEmpty).toBeErr();
      await checkVersion(GENESIS_VERSION.id);

      throwIfError(
        await applyTransactions(kg, [
          mockTransactionInit,
          mockTransactionUpdate,
        ]),
      );
      throwIfError(await undoTransactions(context, 1));

      const resultOverflow = await redoTransactions(context, 5);
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
      throwIfError(await undoTransactions(context, 1));
      throwIfError(await applyTransactions(kg, [mockTransaction3]));

      const result = await redoTransactions(context, 1);
      expect(result).toBeErr();
      await checkVersion(mockTransaction3.id);
    });
  });
  describe("squashTransactions", () => {
    it("squashes two transactions into one", async () => {
      throwIfError(
        await applyTransactions(kg, [
          mockTransactionInit,
          mockTransactionUpdate,
          mockTransaction3,
        ]),
      );

      const squashed = throwIfError(await squashTransactions(context, 2));

      await checkVersion(mockTransactionUpdate.id);

      const mainLog = throwIfError(
        await readLastTransactions(fs, transactionLogPath, 2),
      );
      expect(mainLog).toEqual([mockTransactionInit, squashed]);
    });

    it("squashes multiple transactions into one", async () => {
      throwIfError(
        await applyTransactions(kg, [
          mockTransactionInit,
          mockTransactionUpdate,
          mockTransaction3,
          mockTransaction4,
        ]),
      );

      const squashed = throwIfError(await squashTransactions(context, 3));

      await checkVersion(mockTransactionUpdate.id);

      const mainLog = throwIfError(
        await readLastTransactions(fs, transactionLogPath, 2),
      );
      expect(mainLog).toEqual([mockTransactionInit, squashed]);
    });

    it("errors on invalid count", async () => {
      const resultLessThan2 = await squashTransactions(context, 1);
      expect(resultLessThan2).toBeErr();
      await checkVersion(GENESIS_VERSION.id);

      throwIfError(
        await applyTransactions(kg, [
          mockTransactionInit,
          mockTransactionUpdate,
        ]),
      );

      const resultOverflow = await squashTransactions(context, 5);
      expect(resultOverflow).toBeErr();
      await checkVersion(mockTransactionUpdate.id);
    });

    it("errors when log and db are out of sync", async () => {
      throwIfError(
        await applyTransactions(kg, [
          mockTransactionInit,
          mockTransactionUpdate,
        ]),
      );

      throwIfError(await removeLastFromLog(fs, transactionLogPath, 1));

      const result = await squashTransactions(context, 2);
      expect(result).toBeErr();
      await checkVersion(mockTransactionInit.id, mockTransactionUpdate.id);
    });
  });
});
