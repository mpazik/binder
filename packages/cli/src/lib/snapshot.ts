import { dirname, isAbsolute, relative, resolve } from "path";
import { createHash } from "node:crypto";
import { eq, like } from "drizzle-orm";
import type {
  EntityUid,
  GraphVersion,
  NamespaceEditable,
  TransactionId,
} from "@binder/repo";
import {
  isErr,
  ok,
  okVoid,
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
  entityUid: EntityUid | null;
  mtime: number;
  size: number;
  hash: string;
};

export const calculateSnapshotHash = async (
  fs: FileSystem,
  filePath: string,
): Promise<string> => {
  const hasher = createHash("sha256");
  for await (const chunk of fs.readFileStream(filePath)) {
    hasher.update(chunk);
  }
  return hasher.digest("hex");
};

export const calculateContentHash = (content: string): string =>
  createHash("sha256").update(content).digest("hex");

const upsertSnapshotMetadata = (
  db: DatabaseCli,
  metadata: {
    path: string;
    txId: TransactionId;
    entityUid: EntityUid | null;
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
          entityUid: metadata.entityUid,
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
      entityUid: snapshot.entityUid,
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

export const getSnapshotEntityUid = (
  db: DatabaseCli,
  path: string,
): EntityUid | undefined => {
  const row = db
    .select({ entityUid: cliSnapshotMetadataTable.entityUid })
    .from(cliSnapshotMetadataTable)
    .where(eq(cliSnapshotMetadataTable.path, path))
    .get();
  return row?.entityUid ?? undefined;
};

export type SnapshotChangeMetadata = { path: string } & (
  | {
      type: "untracked";
    }
  | {
      type: "outdated" | "updated";
      txId: TransactionId;
      entityUid: EntityUid | null;
    }
  | {
      type: "removed";
      txId: TransactionId;
      entityUid: EntityUid | null;
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
  if (absolutePath.startsWith(paths.docs)) return "record";
  if (absolutePath.startsWith(paths.binder)) return "config";
};

export const resolveSnapshotPath = (
  userPath: string | undefined,
  paths: ConfigPaths,
): string => {
  if (!userPath) return paths.docs;
  if (isAbsolute(userPath)) return userPath;

  const docsDir = relative(paths.root, paths.docs);
  const isBinderPath =
    userPath === BINDER_DIR || userPath.startsWith(BINDER_DIR + "/");
  const isRootRelativeDocsPath =
    docsDir !== "" &&
    (userPath === docsDir || userPath.startsWith(`${docsDir}/`));

  return resolve(
    isBinderPath || isRootRelativeDocsPath ? paths.root : paths.docs,
    userPath,
  );
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
  const allMetadataResult = getSnapshotMetadata(db, undefined);
  if (isErr(allMetadataResult)) return allMetadataResult;
  const allMetadata = allMetadataResult.data;

  const metadataByPath = new Map(allMetadata.map((m) => [m.path, m]));
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
    if (statResult.data.size === metadata.size) {
      const hash = await calculateSnapshotHash(fs, absolutePath);
      if (hash === metadata.hash) return ok(null);
    }

    return ok({
      type: statResult.data.mtime > metadata.mtime ? "updated" : "outdated",
      path: snapshotPath,
      txId: metadata.txId,
      entityUid: metadata.entityUid,
    });
  };

  const scanResults: SnapshotChangeMetadata[] = [];

  const readdirResult = await fs.readdir(scopePath);

  if (isErr(readdirResult)) {
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
  for (const metadata of allMetadata) {
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
        entityUid: metadata.entityUid,
      });
    }
  }

  return ok([...scanResults, ...removedFiles]);
};

/**
 * Controls how saveSnapshot handles files that already exist on disk:
 * - `fast`: skip write when the content hash matches the stored snapshot (default)
 * - `verify`: also check the actual file on disk; report `skipped-diverged` if it differs
 * - `force`: overwrite diverged files to restore database state
 */
export type SnapshotMode = "fast" | "verify" | "force";
export type SnapshotSaveResult = "written" | "skipped" | "skipped-diverged";

export const saveSnapshot = async (
  db: DatabaseCli,
  fs: FileSystem,
  paths: ConfigPaths,
  filePath: string,
  content: string,
  version: GraphVersion,
  entityUid: EntityUid | null,
  options?: { mode?: SnapshotMode },
): ResultAsync<SnapshotSaveResult> => {
  const mode = options?.mode ?? "fast";
  const absolutePath = resolveSnapshotPath(filePath, paths);
  const snapshotPath = getRelativeSnapshotPath(absolutePath, paths);
  const newHash = calculateContentHash(content);

  const existingMetadata = db
    .select()
    .from(cliSnapshotMetadataTable)
    .where(eq(cliSnapshotMetadataTable.path, snapshotPath))
    .get();

  if (existingMetadata && existingMetadata.hash === newHash) {
    const exists = await fs.exists(absolutePath);
    if (exists) {
      if (mode === "fast") return ok("skipped");

      // verify or force: check actual file content
      const statResult = fs.stat(absolutePath);
      if (isErr(statResult)) return statResult;

      const fileStat = statResult.data;
      let fileDiverged = false;

      if (
        fileStat.mtime !== existingMetadata.mtime ||
        fileStat.size !== existingMetadata.size
      ) {
        const fileHash = await calculateSnapshotHash(fs, absolutePath);
        fileDiverged = fileHash !== existingMetadata.hash;
      }

      if (!fileDiverged) return ok("skipped");

      if (mode === "verify") return ok("skipped-diverged");

      // mode === "force": fall through to write
    }
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
    entityUid,
    mtime: statResult.data.mtime,
    size: statResult.data.size,
    hash: newHash,
  });
  if (isErr(insertResult)) return insertResult;

  return ok("written");
};

export const refreshSnapshotMetadata = (
  db: DatabaseCli,
  fs: FileSystem,
  paths: ConfigPaths,
  absolutePath: string,
  content: string,
  version: GraphVersion,
  entityUid: EntityUid | null,
): Result<void> => {
  const snapshotPath = getRelativeSnapshotPath(absolutePath, paths);
  const hash = calculateContentHash(content);

  const statResult = fs.stat(absolutePath);
  if (isErr(statResult)) return statResult;

  return upsertSnapshotMetadata(db, {
    path: snapshotPath,
    txId: version.id,
    entityUid,
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

  return okVoid;
};
