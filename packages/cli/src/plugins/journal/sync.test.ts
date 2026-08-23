import { beforeEach, describe, expect, it } from "bun:test";
import "@binder/utils/tests";
import {
  mockRecordSchema,
  mockTransactionInit,
  mockTransactionInputUpdate,
  mockTransactionUpdate,
} from "@binder/repo/mocks";
import {
  coreConfigSchema,
  type Database,
  GENESIS_VERSION,
  type KnowledgeGraph,
  openKnowledgeGraph,
  type Transaction,
  withHashTransaction,
} from "@binder/repo";
import { appendLines, readLastLines, throwIfError } from "@binder/utils";
import { serializeTransaction, parseTransaction } from "@binder/repo";
import { TRANSACTION_LOG_FILE, UNDO_LOG_FILE } from "../../config.ts";
import {
  createMockRuntimeContextWithDb,
  mockConfig,
} from "../../runtime.mock.ts";
import type { RuntimeContextWithDb } from "../../runtime.ts";
import type { FileSystem } from "../../lib/filesystem.ts";
import {
  applyTransactions,
  repairDbFromLog,
  syncLogFromDb,
  type VerifySync,
  verifySync,
} from "./sync.ts";

describe("journal sync", () => {
  const dataPath = mockConfig.paths.data;
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

  describe("verifySync", () => {
    const checkSync = async (
      logTxs: Transaction[],
      dbTxs: Transaction[],
      expected: VerifySync,
    ) => {
      const kg = openKnowledgeGraph(db);
      for (const tx of dbTxs) throwIfError(await kg.apply(tx));
      throwIfError(
        await appendLines(fs, transactionLogPath, logTxs, serializeTransaction),
      );

      const result = await verifySync({ fs, kg }, dataPath);
      expect(throwIfError(result)).toEqual(expected);
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

  describe("syncLogFromDb", () => {
    it("appends transactions missing from the log", async () => {
      const kg = openKnowledgeGraph(db);
      throwIfError(await kg.apply(mockTransactionInit));
      throwIfError(await kg.apply(mockTransactionUpdate));
      throwIfError(
        await appendLines(
          fs,
          transactionLogPath,
          [mockTransactionInit],
          serializeTransaction,
        ),
      );

      throwIfError(await syncLogFromDb(context));

      expect(
        throwIfError(
          await readLastLines(fs, transactionLogPath, 10, parseTransaction),
        ),
      ).toEqual([mockTransactionInit, mockTransactionUpdate]);
    });

    it("rebuilds a divergent log from the database", async () => {
      const kg = openKnowledgeGraph(db);
      throwIfError(await kg.apply(mockTransactionInit));
      throwIfError(await kg.apply(mockTransactionUpdate));
      const divergedTx = await withHashTransaction(
        coreConfigSchema,
        mockRecordSchema,
        { ...mockTransactionUpdate, author: "different-user" },
        mockTransactionUpdate.id,
      );
      throwIfError(
        await appendLines(
          fs,
          transactionLogPath,
          [mockTransactionInit, divergedTx],
          serializeTransaction,
        ),
      );

      throwIfError(await syncLogFromDb(context));

      expect(
        throwIfError(
          await readLastLines(fs, transactionLogPath, 10, parseTransaction),
        ),
      ).toEqual([mockTransactionInit, mockTransactionUpdate]);
    });
  });

  describe("repairDbFromLog", () => {
    const checkRepair = async (
      logTxs: Transaction[],
      dbTxs: Transaction[],
      loggedDbTxs: Transaction[] = [],
    ) => {
      const kg = openKnowledgeGraph(db);
      for (const tx of dbTxs) throwIfError(await kg.apply(tx));
      throwIfError(
        await appendLines(fs, transactionLogPath, logTxs, serializeTransaction),
      );

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
          await readLastLines(
            fs,
            dbTransactionsPath!,
            loggedDbTxs.length,
            parseTransaction,
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
        await readLastLines(fs, transactionLogPath, 10, parseTransaction),
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

      // Undo to populate the undo log.
      const versionResult = throwIfError(await kg.version());
      throwIfError(await kg.rollback(1, versionResult.id));

      const undoLogBefore = throwIfError(
        await readLastLines(fs, undoLogPath, 10, parseTransaction),
      );
      expect(undoLogBefore).toEqual([mockTransactionUpdate]);

      throwIfError(await kg.update(mockTransactionInputUpdate));

      const undoLogAfter = throwIfError(
        await readLastLines(fs, undoLogPath, 10, parseTransaction),
      );
      expect(undoLogAfter).toEqual([]);
    });
  });
});
