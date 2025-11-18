import { dirname, relative } from "path";
import { like } from "drizzle-orm";
import type {
  GraphVersion,
  NamespaceEditable,
  TransactionId,
} from "@binder/db";
import {
  isErr,
  ok,
  type Result,
  type ResultAsync,
  tryCatch,
} from "@binder/utils";
import type { DatabaseCli } from "../db";
import { cliSnapshotMetadataTable } from "../db/schema.ts";
import type { ConfigPaths } from "../config.ts";
import type { FileSystem } from "./filesystem.ts";

export type SnapshotMetadata = {
  id?: number;
  path: string;
  txId: TransactionId;
  mtime: number;
  size: number;
  hash: string;
};

const toSnapshotPath = (
  absolutePath: string,
  paths: ConfigPaths,
  namespace: NamespaceEditable,
): string =>
  relative(namespace === "config" ? paths.root : paths.docs, absolutePath);

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
  scopePath?: string,
): Result<SnapshotMetadata[]> => {
  return tryCatch(() =>
    db
      .select()
      .from(cliSnapshotMetadataTable)
      .where(
        scopePath
          ? like(cliSnapshotMetadataTable.path, `${scopePath}%`)
          : undefined,
      )
      .all(),
  );
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
  paths: ConfigPaths,
  scopePath: string = paths.docs,
): ResultAsync<FileChangeMetadata[]> => {
  const snapshotMetadataResult = getSnapshotMetadata(db, undefined);
  if (isErr(snapshotMetadataResult)) return snapshotMetadataResult;
  const snapshotMetadata = snapshotMetadataResult.data;

  const metadataByPath = new Map(snapshotMetadata.map((m) => [m.path, m]));
  const seenPaths = new Set<string>();

  const checkFile = async (
    absolutePath: string,
    namespace: NamespaceEditable,
  ): ResultAsync<FileChangeMetadata | null> => {
    const snapshotPath = toSnapshotPath(absolutePath, paths, namespace);
    seenPaths.add(snapshotPath);
    const metadata = metadataByPath.get(snapshotPath);

    if (!metadata) {
      return ok({
        type: "untracked",
        path: snapshotPath,
      });
    }

    const statResult = fs.stat(absolutePath);
    if (isErr(statResult)) return statResult;
    const stats = statResult.data;
    if (stats.size === metadata.size) {
      const hash = await calculateFileHash(fs, absolutePath);
      if (hash === metadata.hash) return ok(null);
    }

    return ok({
      type: stats.mtime > metadata.mtime ? "updated" : "outdated",
      path: snapshotPath,
      txId: metadata.txId,
    });
  };

  const scanDirectory = async (
    dirPath: string,
    namespace: NamespaceEditable,
  ): ResultAsync<FileChangeMetadata[]> => {
    const entriesResult = await fs.readdir(dirPath);
    if (isErr(entriesResult)) return entriesResult;
    const modified: FileChangeMetadata[] = [];

    for (const entry of entriesResult.data) {
      const filePath = `${dirPath}/${entry.name}`;

      if (entry.isDirectory) {
        const result = await scanDirectory(filePath, namespace);
        if (isErr(result)) return result;
        modified.push(...result.data);
      } else if (entry.isFile) {
        const fileResult = await checkFile(filePath, namespace);
        if (isErr(fileResult)) return fileResult;
        if (fileResult.data) modified.push(fileResult.data);
      }
    }
    return ok(modified);
  };

  const scanResults: FileChangeMetadata[] = [];
  const namespace = scopePath.startsWith(paths.binder) ? "config" : "node";
  const isDirectoryResult = await fs.readdir(scopePath);

  if (isErr(isDirectoryResult)) {
    const fileResult = await checkFile(scopePath, namespace);
    if (isErr(fileResult)) return fileResult;
    if (fileResult.data) scanResults.push(fileResult.data);
  } else {
    const result = await scanDirectory(scopePath, namespace);
    if (isErr(result)) return result;
    scanResults.push(...result.data);
  }

  const scopePrefix = toSnapshotPath(scopePath, paths, namespace);

  const removedFiles: FileChangeMetadata[] = [];
  for (const metadata of snapshotMetadata) {
    if (seenPaths.has(metadata.path)) continue;

    if (metadata.path.startsWith(scopePrefix)) {
      removedFiles.push({
        type: "removed",
        path: metadata.path,
        txId: metadata.txId,
      });
    }
  }

  return ok([...scanResults, ...removedFiles]);
};

export const saveSnapshot = async (
  db: DatabaseCli,
  fs: FileSystem,
  paths: ConfigPaths,
  absolutePath: string,
  content: string,
  version: GraphVersion,
  namespace: NamespaceEditable = "node",
): ResultAsync<void> => {
  const mkdirResult = await fs.mkdir(dirname(absolutePath), {
    recursive: true,
  });
  if (isErr(mkdirResult)) return mkdirResult;

  const writeResult = await fs.writeFile(absolutePath, content);
  if (isErr(writeResult)) return writeResult;

  const statResult = fs.stat(absolutePath);
  if (isErr(statResult)) return statResult;

  const hash = await calculateFileHash(fs, absolutePath);
  const size = statResult.data.size;
  const mtime = statResult.data.mtime;
  const snapshotPath = toSnapshotPath(absolutePath, paths, namespace);

  return tryCatch(() => {
    db.insert(cliSnapshotMetadataTable)
      .values({
        path: snapshotPath,
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
