import { beforeEach, describe, expect, it } from "bun:test";
import "@binder/utils/tests";
import {
  mockTransaction3,
  mockTransaction4,
  mockTransactionInit,
  mockTransactionUpdate,
} from "@binder/repo/mocks";
import { appendLines, readLastLines, throwIfError } from "@binder/utils";
import { serializeTransaction, parseTransaction } from "@binder/repo";
import { createInMemoryFileSystem } from "../../lib/filesystem.mock.ts";
import { undoOnCommit, undoOnRollback } from "./handlers.ts";

describe("undo handlers", () => {
  const fs = createInMemoryFileSystem();
  const root = "/test-root";
  const undoPath = `${root}/undo.jsonl`;

  const readUndoLog = async () =>
    throwIfError(await readLastLines(fs, undoPath, 100, parseTransaction));

  beforeEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.mkdir(root, { recursive: true });
  });

  describe("undoOnRollback", () => {
    it("appends reverted transactions to the undo-log", async () => {
      throwIfError(
        await undoOnRollback(fs, undoPath, [
          mockTransaction4,
          mockTransaction3,
        ]),
      );

      expect(await readUndoLog()).toEqual([mockTransaction4, mockTransaction3]);
    });

    it("is a no-op for an empty transactions list", async () => {
      throwIfError(await undoOnRollback(fs, undoPath, []));

      expect(await readUndoLog()).toEqual([]);
    });
  });

  describe("undoOnCommit", () => {
    it("clears the undo-log on commit", async () => {
      throwIfError(
        await appendLines(
          fs,
          undoPath,
          [mockTransaction3],
          serializeTransaction,
        ),
      );

      throwIfError(await undoOnCommit(fs, undoPath, mockTransactionUpdate));

      expect(await readUndoLog()).toEqual([]);
    });

    it("is a no-op when undo-log does not exist", async () => {
      throwIfError(await undoOnCommit(fs, undoPath, mockTransactionInit));

      expect(await readUndoLog()).toEqual([]);
    });
  });
});
