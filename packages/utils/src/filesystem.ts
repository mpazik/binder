import type { Result, ResultAsync } from "./result.ts";

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
