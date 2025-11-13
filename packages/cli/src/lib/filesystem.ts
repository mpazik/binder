import {
  appendFileSync,
  existsSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  closeSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import {
  errorToObject,
  type Result,
  type ResultAsync,
  tryCatch,
} from "@binder/utils";

export type FileStat = {
  size: number;
};

export type DirEntry = {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
};

export type FileSystem = {
  exists: (path: string) => boolean;
  readFile: (path: string) => ResultAsync<string>;
  writeFile: (path: string, content: string) => Result<void>;
  appendFile: (path: string, content: string) => Result<void>;
  stat: (path: string) => ResultAsync<FileStat>;
  slice: (path: string, start: number, end: number) => ResultAsync<ArrayBuffer>;
  truncate: (path: string, size: number) => ResultAsync<void>;
  mkdir: (path: string, options?: { recursive?: boolean }) => Result<void>;
  rm: (
    path: string,
    options?: { recursive?: boolean; force?: boolean },
  ) => Result<void>;
  readdir: (path: string) => Result<DirEntry[]>;
  renameFile: (oldPath: string, newPath: string) => Result<void>;
};

export const createRealFileSystem = (): FileSystem => {
  return {
    exists: (path: string) => existsSync(path),

    readFile: async (path: string) => {
      return tryCatch(async () => {
        const file = Bun.file(path);
        return await file.text();
      }, errorToObject);
    },

    writeFile: (path: string, content: string) => {
      return tryCatch(() => {
        writeFileSync(path, content, "utf-8");
      }, errorToObject);
    },

    appendFile: (path: string, content: string) => {
      return tryCatch(() => {
        appendFileSync(path, content, "utf-8");
      }, errorToObject);
    },

    stat: async (path: string) => {
      return tryCatch(async () => {
        const file = Bun.file(path);
        const stats = await file.stat();
        return { size: stats.size };
      }, errorToObject);
    },

    slice: async (path: string, start: number, end: number) => {
      return tryCatch(async () => {
        const file = Bun.file(path);
        return await file.slice(start, end).arrayBuffer();
      }, errorToObject);
    },

    truncate: async (path: string, size: number) => {
      return tryCatch(() => {
        const fd = openSync(path, "r+");
        ftruncateSync(fd, size);
        closeSync(fd);
      }, errorToObject);
    },

    mkdir: (path: string, options?: { recursive?: boolean }) => {
      return tryCatch(() => {
        mkdirSync(path, options);
      }, errorToObject);
    },

    rm: (path: string, options?: { recursive?: boolean; force?: boolean }) => {
      return tryCatch(() => {
        rmSync(path, options);
      }, errorToObject);
    },

    readdir: (path: string) => {
      return tryCatch(() => {
        const entries = readdirSync(path, { withFileTypes: true });
        return entries.map((entry) => ({
          name: entry.name,
          isFile: entry.isFile(),
          isDirectory: entry.isDirectory(),
        }));
      }, errorToObject);
    },

    renameFile: (oldPath: string, newPath: string) => {
      return tryCatch(() => {
        renameSync(oldPath, newPath);
      }, errorToObject);
    },
  };
};
