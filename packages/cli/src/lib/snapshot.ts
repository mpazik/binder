import { dirname } from "path";
import type { GraphVersion, TransactionId } from "@binder/db";
import {
  isErr,
  ok,
  type Result,
  type ResultAsync,
  tryCatch,
} from "@binder/utils";
import type { DatabaseCli } from "../db";
import { cliSnapshotMetadataTable } from "../db/schema.ts";
import type { FileSystem } from "./filesystem.ts";

export type SnapshotMetadata = {
  id?: number;
  path: string;
  txId: TransactionId;
  mtime: number;
  size: number;
  hash: string;
};

export const calculateFileHash = async (
  fs: FileSystem,
  filePath: string,
): Promise<string> => {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of fs.readFileStream(filePath)) {
    hasher.update(chunk);
  }
  return hasher.digest("hex");
};

export const saveSnapshotMetadata = async (
  db: DatabaseCli,
  snapshots: SnapshotMetadata[],
): Promise<void> => {
  if (snapshots.length === 0) return;

  await db.insert(cliSnapshotMetadataTable).values(
    snapshots.map((snapshot) => ({
      path: snapshot.path,
      txId: snapshot.txId,
      mtime: snapshot.mtime,
      size: snapshot.size,
      hash: snapshot.hash,
    })),
  );
};

export const getSnapshotMetadata = (
  db: DatabaseCli,
): Result<SnapshotMetadata[]> => {
  return tryCatch(() => db.select().from(cliSnapshotMetadataTable).all());
};

export type FileChangeMetadata = { path: string } & (
  | {
      type: "untracked";
    }
  | {
      type: "outdated" | "updated";
      txId: TransactionId;
    }
  | {
      type: "removed";
      txId: TransactionId;
    }
);

export const modifiedFiles = async (
  db: DatabaseCli,
  fs: FileSystem,
  rootPath: string,
): ResultAsync<FileChangeMetadata[]> => {
  const snapshotMetadataResult = getSnapshotMetadata(db);
  if (isErr(snapshotMetadataResult)) return snapshotMetadataResult;
  const snapshotMetadata = snapshotMetadataResult.data;
  const metadataByPath = new Map(snapshotMetadata.map((m) => [m.path, m]));
  const seenPaths = new Set<string>();

  const scanDirectory = async (
    dirPath: string,
  ): ResultAsync<FileChangeMetadata[]> => {
    const entriesResult = await fs.readdir(dirPath);
    if (isErr(entriesResult)) return entriesResult;
    const modified: FileChangeMetadata[] = [];

    for (const entry of entriesResult.data) {
      const filePath = `${dirPath}/${entry.name}`;

      if (entry.isDirectory) {
        const result = await scanDirectory(filePath);
        if (isErr(result)) return result;
        modified.push(...result.data);
      } else if (entry.isFile) {
        seenPaths.add(filePath);
        const metadata = metadataByPath.get(filePath);

        if (!metadata) {
          modified.push({
            type: "untracked",
            path: filePath,
          });
          continue;
        }

        const statResult = fs.stat(filePath);
        if (isErr(statResult)) return statResult;
        const stats = statResult.data;
        if (stats.size === metadata.size) {
          const hash = await calculateFileHash(fs, filePath);
          if (hash === metadata.hash) continue;
        }

        modified.push({
          type: stats.mtime > metadata.mtime ? "updated" : "outdated",
          path: filePath,
          txId: metadata.txId,
        });
      }
    }
    return ok(modified);
  };

  const scanResult = await scanDirectory(rootPath);
  if (isErr(scanResult)) return scanResult;

  const removedFiles: FileChangeMetadata[] = [];
  for (const metadata of snapshotMetadata) {
    if (!seenPaths.has(metadata.path)) {
      removedFiles.push({
        type: "removed",
        path: metadata.path,
        txId: metadata.txId,
      });
    }
  }

  return ok([...scanResult.data, ...removedFiles]);
};

export const saveSnapshot = async (
  db: DatabaseCli,
  fs: FileSystem,
  filePath: string,
  content: string,
  version: GraphVersion,
): ResultAsync<void> => {
  const mkdirResult = await fs.mkdir(dirname(filePath), { recursive: true });
  if (isErr(mkdirResult)) return mkdirResult;

  const writeResult = await fs.writeFile(filePath, content);
  if (isErr(writeResult)) return writeResult;

  const statResult = fs.stat(filePath);
  if (isErr(statResult)) return statResult;

  const hash = await calculateFileHash(fs, filePath);
  const size = statResult.data.size;
  const mtime = statResult.data.mtime;

  return tryCatch(() => {
    db.insert(cliSnapshotMetadataTable)
      .values({
        path: filePath,
        txId: version.id,
        mtime,
        size,
        hash,
      })
      .onConflictDoUpdate({
        target: cliSnapshotMetadataTable.path,
        set: {
          txId: version.id,
          mtime,
          size,
          hash,
        },
      })
      .run();
  });
};
