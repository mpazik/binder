import { basename, join } from "node:path";
import {
  applyConfigChangesetToSchema,
  coreRecordSchema,
  GENESIS_VERSION,
  hashTransaction,
  parseTransaction,
  type RecordSchema,
  serializeTransaction,
  type TransactionHash,
  transactionToCanonical,
  withHashTransaction,
} from "@binder/repo";
import {
  appendLine,
  clearLog,
  fail,
  getTimestampForFileName,
  isErr,
  isObjectNonEmpty,
  ok,
  readLinesFromBeginning,
  type ResultAsync,
} from "@binder/utils";
import { cliFullConfigSchema } from "../../cli-config-schema.ts";
import type { FileSystem } from "../../lib/filesystem.ts";

export const verifyLog = async (
  fs: FileSystem,
  path: string,
  options?: { verifyIntegrity?: boolean },
): ResultAsync<{ count: number }> => {
  if (!(await fs.exists(path))) return ok({ count: 0 });

  let count = 0;
  let lineNumber = 0;
  let previousHash: TransactionHash = GENESIS_VERSION.hash;
  let schema: RecordSchema = coreRecordSchema();

  for await (const result of readLinesFromBeginning(
    fs,
    path,
    parseTransaction,
  )) {
    lineNumber++;

    if (isErr(result))
      return fail(
        "parse-error",
        `Failed to parse transaction at line ${lineNumber}`,
        {
          data: { line: lineNumber, error: result.error },
        },
      );

    const transaction = result.data;
    if (transaction.previous !== previousHash)
      return fail(
        "chain-error",
        `Transaction chain broken at transaction ${lineNumber}`,
        {
          data: {
            transactionId: transaction.id,
            expectedPrevious: previousHash,
            actualPrevious: transaction.previous,
          },
        },
      );

    if (isObjectNonEmpty(transaction.configs)) {
      schema = applyConfigChangesetToSchema(schema, transaction.configs);
    }

    if (options?.verifyIntegrity) {
      const canonical = transactionToCanonical(
        cliFullConfigSchema,
        schema,
        transaction,
      );
      const expectedHash = await hashTransaction(canonical);

      if (expectedHash !== transaction.hash)
        return fail(
          "hash-mismatch",
          `Transaction hash mismatch at transaction ${lineNumber}`,
          {
            data: {
              transactionId: transaction.id,
              expectedHash,
              actualHash: transaction.hash,
            },
          },
        );
    }

    previousHash = transaction.hash;
    count++;
  }

  return ok({ count });
};

export const rehashLog = async (
  fs: FileSystem,
  path: string,
  options?: { backupDir?: string },
): ResultAsync<{ transactionsRehashed: number; backupPath: string }> => {
  if (!(await fs.exists(path)))
    return fail("file-not-found", "Transaction log file does not exist", {
      data: { path },
    });

  const timestamp = getTimestampForFileName();
  const backupFileName = basename(path).replace(
    /\.jsonl$/,
    `-${timestamp}.jsonl.bac`,
  );
  const backupPath = options?.backupDir
    ? join(options.backupDir, backupFileName)
    : path.replace(/\.jsonl$/, `-${timestamp}.jsonl.bac`);

  const renameResult = await fs.renameFile(path, backupPath);
  if (isErr(renameResult)) return renameResult;

  const clearResult = await clearLog(fs, path);
  if (isErr(clearResult)) return clearResult;

  let previousHash: TransactionHash = GENESIS_VERSION.hash;
  let schema: RecordSchema = coreRecordSchema();
  let transactionsRehashed = 0;

  for await (const result of readLinesFromBeginning(
    fs,
    backupPath,
    parseTransaction,
  )) {
    if (isErr(result)) return result;

    const tx = { ...result.data, previous: previousHash };
    if (isObjectNonEmpty(tx.configs)) {
      schema = applyConfigChangesetToSchema(schema, tx.configs);
    }
    const rehashedTx = await withHashTransaction(
      cliFullConfigSchema,
      schema,
      tx,
      tx.id,
    );
    const logResult = await appendLine(
      fs,
      path,
      rehashedTx,
      serializeTransaction,
    );
    if (isErr(logResult)) return logResult;
    previousHash = rehashedTx.hash;
    transactionsRehashed++;
  }

  return ok({ transactionsRehashed, backupPath });
};
