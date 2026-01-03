import { dirname, isAbsolute, relative, resolve } from "path";
import { eq, like } from "drizzle-orm";
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
import { BINDER_DIR, type ConfigPaths } from "../config.ts";
import { createPathMatcher, type MatchOptions } from "../utils/file.ts";
import type { FileSystem } from "./filesystem.ts";

export type SnapshotMetadata = {
  id?: number;
  path: string;
  txId: TransactionId;
  mtime: number;
  size: number;
  hash: string;
};

export const calculateSnapshotHash = async (
  fs: FileSystem,
  filePath: string,
): Promise<string> => {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of fs.readFileStream(filePath)) {
    hasher.update(chunk);
  }
  return hasher.digest("hex");
};

const calculateContentHash = (content: string): string => {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(content);
  return hasher.digest("hex");
};

const upsertSnapshotMetadata = (
  db: DatabaseCli,
  metadata: {
    path: string;
    txId: TransactionId;
    mtime: number;
    size: number;
    hash: string;
  },
): Result<void> => {
  return tryCatch(() => {
    db.insert(cliSnapshotMetadataTable)
      .values(metadata)
      .onConflictDoUpdate({
        target: cliSnapshotMetadataTable.path,
        set: {
          txId: metadata.txId,
          mtime: metadata.mtime,
          size: metadata.size,
          hash: metadata.hash,
        },
      })
      .run();
  });
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

export type SnapshotChangeMetadata = { path: string } & (
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

export const snapshotRootForNamespace = (
  namespace: NamespaceEditable,
  paths: ConfigPaths,
): string => (namespace === "config" ? paths.binder : paths.docs);

export const namespaceFromSnapshotPath = (
  path: string,
  paths: ConfigPaths,
): NamespaceEditable | undefined => {
  const absolutePath = resolveSnapshotPath(path, paths);
  if (absolutePath.startsWith(paths.docs)) return "node";
  if (absolutePath.startsWith(paths.binder)) return "config";
};

export const resolveSnapshotPath = (
  userPath: string | undefined,
  paths: ConfigPaths,
): string => {
  if (!userPath) return paths.docs;
  if (isAbsolute(userPath)) return userPath;

  const root = userPath === BINDER_DIR || userPath.startsWith(BINDER_DIR + "/");
  return resolve(root ? paths.root : paths.docs, userPath);
};

export const getRelativeSnapshotPath = (
  absolutePath: string,
  paths: ConfigPaths,
): string => {
  if (absolutePath.startsWith(paths.binder)) {
    return relative(paths.root, absolutePath);
  }
  return relative(paths.docs, absolutePath);
};

export const modifiedSnapshots = async (
  db: DatabaseCli,
  fs: FileSystem,
  paths: ConfigPaths,
  scopePath: string = paths.docs,
  options: MatchOptions = {},
): ResultAsync<SnapshotChangeMetadata[]> => {
  const snapshotMetadataResult = getSnapshotMetadata(db, undefined);
  if (isErr(snapshotMetadataResult)) return snapshotMetadataResult;
  const snapshotMetadata = snapshotMetadataResult.data;

  const metadataByPath = new Map(snapshotMetadata.map((m) => [m.path, m]));
  const seenPaths = new Set<string>();
  const shouldInclude = createPathMatcher(options);

  const checkFile = async (
    absolutePath: string,
  ): ResultAsync<SnapshotChangeMetadata | null> => {
    const snapshotPath = getRelativeSnapshotPath(absolutePath, paths);

    if (!shouldInclude(snapshotPath)) return ok(null);

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
      const hash = await calculateSnapshotHash(fs, absolutePath);
      if (hash === metadata.hash) return ok(null);
    }

    return ok({
      type: stats.mtime > metadata.mtime ? "updated" : "outdated",
      path: snapshotPath,
      txId: metadata.txId,
    });
  };

  const scanResults: SnapshotChangeMetadata[] = [];

  const isDirectoryResult = await fs.readdir(scopePath);

  if (isErr(isDirectoryResult)) {
    const fileResult = await checkFile(scopePath);
    if (isErr(fileResult)) return fileResult;
    if (fileResult.data) scanResults.push(fileResult.data);
  } else {
    for await (const filePath of fs.scan(scopePath)) {
      const fileResult = await checkFile(filePath);
      if (isErr(fileResult)) return fileResult;
      if (fileResult.data) scanResults.push(fileResult.data);
    }
  }

  const scopePrefix = getRelativeSnapshotPath(scopePath, paths);

  const removedFiles: SnapshotChangeMetadata[] = [];
  for (const metadata of snapshotMetadata) {
    if (seenPaths.has(metadata.path)) continue;
    if (!shouldInclude(metadata.path)) continue;

    // When scopePrefix is empty (docs root), exclude config files
    const isInScope =
      scopePrefix === ""
        ? !metadata.path.startsWith(BINDER_DIR)
        : metadata.path.startsWith(scopePrefix);

    if (isInScope) {
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
  filePath: string,
  content: string,
  version: GraphVersion,
): ResultAsync<boolean> => {
  const absolutePath = resolveSnapshotPath(filePath, paths);
  const snapshotPath = getRelativeSnapshotPath(absolutePath, paths);
  const newHash = calculateContentHash(content);

  const existingMetadata = db
    .select()
    .from(cliSnapshotMetadataTable)
    .where(eq(cliSnapshotMetadataTable.path, snapshotPath))
    .get();

  if (existingMetadata && existingMetadata.hash === newHash) {
    return ok(false);
  }

  const mkdirResult = await fs.mkdir(dirname(absolutePath), {
    recursive: true,
  });
  if (isErr(mkdirResult)) return mkdirResult;

  const writeResult = await fs.writeFile(absolutePath, content);
  if (isErr(writeResult)) return writeResult;

  const statResult = fs.stat(absolutePath);
  if (isErr(statResult)) return statResult;

  const insertResult = upsertSnapshotMetadata(db, {
    path: snapshotPath,
    txId: version.id,
    mtime: statResult.data.mtime,
    size: statResult.data.size,
    hash: newHash,
  });
  if (isErr(insertResult)) return insertResult;

  return ok(true);
};

export const refreshSnapshotMetadata = (
  db: DatabaseCli,
  fs: FileSystem,
  paths: ConfigPaths,
  absolutePath: string,
  content: string,
  version: GraphVersion,
): Result<void> => {
  const snapshotPath = getRelativeSnapshotPath(absolutePath, paths);
  const hash = calculateContentHash(content);

  const statResult = fs.stat(absolutePath);
  if (isErr(statResult)) return statResult;

  return upsertSnapshotMetadata(db, {
    path: snapshotPath,
    txId: version.id,
    mtime: statResult.data.mtime,
    size: statResult.data.size,
    hash,
  });
};

export const cleanupOrphanSnapshots = async (
  db: DatabaseCli,
  fs: FileSystem,
  paths: ConfigPaths,
  renderedPaths: string[],
  namespace: NamespaceEditable,
): ResultAsync<void> => {
  const allMetadataResult = getSnapshotMetadata(db);
  if (isErr(allMetadataResult)) return allMetadataResult;

  const renderedSet = new Set(renderedPaths);
  const isConfigNamespace = namespace === "config";

  for (const metadata of allMetadataResult.data) {
    const isConfigPath = metadata.path.startsWith(BINDER_DIR);
    if (isConfigPath !== isConfigNamespace) continue;
    if (renderedSet.has(metadata.path)) continue;

    const absolutePath = resolveSnapshotPath(metadata.path, paths);
    const exists = await fs.exists(absolutePath);
    if (exists) {
      const rmResult = await fs.rm(absolutePath);
      if (isErr(rmResult)) return rmResult;
    }

    const deleteResult = tryCatch(() => {
      db.delete(cliSnapshotMetadataTable)
        .where(eq(cliSnapshotMetadataTable.path, metadata.path))
        .run();
    });
    if (isErr(deleteResult)) return deleteResult;
  }

  return ok(undefined);
};
