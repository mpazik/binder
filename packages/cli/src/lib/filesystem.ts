import { mkdir, readdir, rename, rm, truncate, access } from "fs/promises";
import { isErr, type Result, type ResultAsync, tryCatch } from "@binder/utils";

export type FileStat = {
  size: number;
  mtime: number;
};

export type DirEntry = {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
};

export type FileSystem = {
  exists: (path: string) => Promise<boolean>;
  readFile: (path: string) => ResultAsync<string>;
  readFileStream: (path: string) => AsyncIterable<Uint8Array>;
  writeFile: (path: string, content: string) => ResultAsync<void>;
  appendFile: (path: string, content: string) => ResultAsync<void>;
  stat: (path: string) => Result<FileStat>;
  slice: (path: string, start: number, end: number) => ResultAsync<ArrayBuffer>;
  truncate: (path: string, size: number) => ResultAsync<void>;
  mkdir: (path: string, options?: { recursive?: boolean }) => ResultAsync<void>;
  rm: (
    path: string,
    options?: { recursive?: boolean; force?: boolean },
  ) => ResultAsync<void>;
  readdir: (path: string) => ResultAsync<DirEntry[]>;
  renameFile: (oldPath: string, newPath: string) => ResultAsync<void>;
  scan: (path: string) => AsyncGenerator<string, void, unknown>;
};

export const createRealFileSystem = (): FileSystem => {
  return {
    exists: async (path: string) => {
      // apparently checking is usser has access is a correct way that also does directory check
      // eslint-disable-next-line no-restricted-syntax
      try {
        await access(path);
        return true;
      } catch {
        return false;
      }
    },

    readFile: async (path: string) =>
      tryCatch(async () => await Bun.file(path).text()),

    readFileStream: (path: string) => Bun.file(path).stream(),

    writeFile: async (path: string, content: string) =>
      tryCatch(async () => {
        await Bun.write(path, content);
      }),

    appendFile: async (path: string, content: string) =>
      tryCatch(async () => {
        const file = Bun.file(path);
        const existingContent = (await file.exists()) ? await file.text() : "";
        await Bun.write(path, existingContent + content);
      }),

    stat: (path: string) =>
      tryCatch(() => {
        const file = Bun.file(path);
        return {
          size: file.size,
          mtime: file.lastModified,
        };
      }),

    slice: async (path: string, start: number, end: number) =>
      tryCatch(
        async () => await Bun.file(path).slice(start, end).arrayBuffer(),
      ),

    truncate: async (path: string, size: number) =>
      tryCatch(() => truncate(path, size)),

    mkdir: async (path: string, options?: { recursive?: boolean }) =>
      tryCatch(async () => {
        await mkdir(path, options);
      }),

    rm: async (
      path: string,
      options?: { recursive?: boolean; force?: boolean },
    ) => tryCatch(async () => await rm(path, options)),

    readdir: async (path: string) =>
      tryCatch(async () => {
        const entries = await readdir(path, { withFileTypes: true });
        return entries.map((entry) => ({
          name: entry.name,
          isFile: entry.isFile(),
          isDirectory: entry.isDirectory(),
        }));
      }),

    renameFile: async (oldPath: string, newPath: string) =>
      tryCatch(async () => await rename(oldPath, newPath)),

    scan: async function* (
      startPath: string,
    ): AsyncGenerator<string, void, unknown> {
      async function* scanDirectory(
        dirPath: string,
      ): AsyncGenerator<string, void, unknown> {
        const entriesResult = await tryCatch(async () => {
          const entries = await readdir(dirPath, { withFileTypes: true });
          return entries.map((entry) => ({
            name: entry.name,
            isFile: entry.isFile(),
            isDirectory: entry.isDirectory(),
          }));
        });
        if (isErr(entriesResult)) return;

        for (const entry of entriesResult.data) {
          const filePath = `${dirPath}/${entry.name}`;

          if (entry.isDirectory) {
            yield* scanDirectory(filePath);
          } else if (entry.isFile) {
            yield filePath;
          }
        }
      }

      yield* scanDirectory(startPath);
    },
  };
};
