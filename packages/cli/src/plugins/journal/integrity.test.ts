import { beforeEach, describe, expect, it } from "bun:test";
import "@binder/utils/tests";
import {
  type Transaction,
  type TransactionHash,
  serializeTransaction,
  parseTransaction,
} from "@binder/repo";
import { mockTransactionInit, mockTransactionUpdate } from "@binder/repo/mocks";
import { appendLines, readLastLines, throwIfError } from "@binder/utils";
import { createInMemoryFileSystem } from "../../lib/filesystem.mock.ts";
import { verifyLog, rehashLog } from "./integrity.ts";

describe("integrity", () => {
  const fs = createInMemoryFileSystem();
  const root = "/test-root";

  beforeEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.mkdir(root, { recursive: true });
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
        throwIfError(
          await appendLines(fs, verifyPath, txs, serializeTransaction),
        );
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

  describe("rehashLog", () => {
    const rehashPath = `${root}/rehash-log.jsonl`;

    it("rehashes all transactions with correct chain", async () => {
      const badHash1 = "bad-hash-1" as TransactionHash;
      throwIfError(
        await appendLines(
          fs,
          rehashPath,
          [
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
          ],
          serializeTransaction,
        ),
      );

      const result = await rehashLog(fs, rehashPath);

      expect(result).toBeOkWith({
        transactionsRehashed: 2,
        backupPath: expect.stringMatching(/rehash-log-.*\.jsonl\.bac$/),
      });
      expect(
        throwIfError(await readLastLines(fs, rehashPath, 10, parseTransaction)),
      ).toEqual([mockTransactionInit, mockTransactionUpdate]);
    });

    it("rehashes correctly when started with empty record schema", async () => {
      throwIfError(
        await appendLines(
          fs,
          rehashPath,
          [mockTransactionInit, mockTransactionUpdate],
          serializeTransaction,
        ),
      );

      const result = await rehashLog(fs, rehashPath);

      expect(result).toBeOkWith({
        transactionsRehashed: 2,
        backupPath: expect.stringMatching(/rehash-log-.*\.jsonl\.bac$/),
      });
      expect(
        throwIfError(await readLastLines(fs, rehashPath, 10, parseTransaction)),
      ).toEqual([mockTransactionInit, mockTransactionUpdate]);
    });
  });
});
