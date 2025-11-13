import { createError, err, isErr, ok, type Result } from "@binder/utils";
import type { FileSystem } from "./filesystem.ts";

type FileEntry = {
  content: string;
  isDirectory: boolean;
};

export const createInMemoryFileSystem = (): FileSystem => {
  const files = new Map<string, FileEntry>();

  const normalizePath = (path: string): string => {
    return path.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
  };

  const getParentPath = (path: string): string | null => {
    const normalized = normalizePath(path);
    const lastSlash = normalized.lastIndexOf("/");
    if (lastSlash <= 0) return null;
    return normalized.substring(0, lastSlash);
  };

  const ensureParentExists = (path: string): Result<void> => {
    const parent = getParentPath(path);
    if (!parent) return ok(undefined);

    const parentEntry = files.get(normalizePath(parent));
    if (!parentEntry) {
      return err(
        createError(
          "parent-not-found",
          `Parent directory does not exist: ${parent}`,
        ),
      );
    }

    if (!parentEntry.isDirectory) {
      return err(
        createError(
          "parent-not-directory",
          `Parent path is not a directory: ${parent}`,
        ),
      );
    }

    return ok(undefined);
  };

  return {
    exists: (path: string) => {
      return files.has(normalizePath(path));
    },

    readFile: async (path: string) => {
      const entry = files.get(normalizePath(path));
      if (!entry) {
        return err(createError("file-not-found", `File not found: ${path}`));
      }

      if (entry.isDirectory) {
        return err(createError("is-directory", `Path is a directory: ${path}`));
      }

      return ok(entry.content);
    },

    writeFile: (path: string, content: string) => {
      const normalized = normalizePath(path);
      const parentCheck = ensureParentExists(normalized);
      if (isErr(parentCheck)) return parentCheck;

      files.set(normalized, { content, isDirectory: false });
      return ok(undefined);
    },

    appendFile: (path: string, content: string) => {
      const normalized = normalizePath(path);
      const entry = files.get(normalized);

      if (entry && entry.isDirectory) {
        return err(createError("is-directory", `Path is a directory: ${path}`));
      }

      const newContent = entry ? entry.content + content : content;
      files.set(normalized, { content: newContent, isDirectory: false });
      return ok(undefined);
    },

    stat: async (path: string) => {
      const entry = files.get(normalizePath(path));
      if (!entry) {
        return err(createError("file-not-found", `File not found: ${path}`));
      }

      if (entry.isDirectory) {
        return err(createError("is-directory", `Path is a directory: ${path}`));
      }

      const encoder = new TextEncoder();
      const size = encoder.encode(entry.content).length;
      return ok({ size });
    },

    slice: async (path: string, start: number, end: number) => {
      const entry = files.get(normalizePath(path));
      if (!entry) {
        return err(createError("file-not-found", `File not found: ${path}`));
      }

      if (entry.isDirectory) {
        return err(createError("is-directory", `Path is a directory: ${path}`));
      }

      const encoder = new TextEncoder();
      const fullBuffer = encoder.encode(entry.content);
      const sliced = fullBuffer.slice(start, end);
      return ok(sliced.buffer);
    },

    truncate: async (path: string, size: number) => {
      const normalized = normalizePath(path);
      const entry = files.get(normalized);
      if (!entry) {
        return err(createError("file-not-found", `File not found: ${path}`));
      }

      if (entry.isDirectory) {
        return err(createError("is-directory", `Path is a directory: ${path}`));
      }

      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      const fullBuffer = encoder.encode(entry.content);
      const truncated = fullBuffer.slice(0, size);
      const newContent = decoder.decode(truncated);

      files.set(normalized, { content: newContent, isDirectory: false });
      return ok(undefined);
    },

    mkdir: (path: string, options?: { recursive?: boolean }) => {
      const normalized = normalizePath(path);

      if (files.has(normalized)) {
        const entry = files.get(normalized);
        if (entry?.isDirectory) {
          return ok(undefined);
        }
        return err(
          createError("path-exists", `Path already exists as file: ${path}`),
        );
      }

      if (options?.recursive) {
        const parts = normalized.split("/").filter((p) => p.length > 0);
        let current = "";
        for (const part of parts) {
          current += "/" + part;
          if (!files.has(current)) {
            files.set(current, { content: "", isDirectory: true });
          }
        }
        return ok(undefined);
      }

      const parentCheck = ensureParentExists(normalized);
      if (isErr(parentCheck)) return parentCheck;

      files.set(normalized, { content: "", isDirectory: true });
      return ok(undefined);
    },

    rm: (path: string, options?: { recursive?: boolean; force?: boolean }) => {
      const normalized = normalizePath(path);

      if (!files.has(normalized)) {
        if (options?.force) {
          return ok(undefined);
        }
        return err(createError("file-not-found", `File not found: ${path}`));
      }

      const entry = files.get(normalized);
      if (entry?.isDirectory && !options?.recursive) {
        return err(
          createError(
            "is-directory",
            `Cannot remove directory without recursive option: ${path}`,
          ),
        );
      }

      if (options?.recursive && entry?.isDirectory) {
        const toDelete: string[] = [];
        for (const [filePath] of files) {
          if (
            filePath === normalized ||
            filePath.startsWith(normalized + "/")
          ) {
            toDelete.push(filePath);
          }
        }
        for (const filePath of toDelete) {
          files.delete(filePath);
        }
      } else {
        files.delete(normalized);
      }

      return ok(undefined);
    },

    readdir: (path: string) => {
      const normalized = normalizePath(path);
      const entry = files.get(normalized);

      if (!entry) {
        return err(
          createError("file-not-found", `Directory not found: ${path}`),
        );
      }

      if (!entry.isDirectory) {
        return err(
          createError("not-directory", `Path is not a directory: ${path}`),
        );
      }

      const entries = [];
      const prefix = normalized === "/" ? "/" : normalized + "/";

      for (const [filePath, fileEntry] of files) {
        if (filePath.startsWith(prefix)) {
          const relativePath = filePath.substring(prefix.length);
          if (!relativePath.includes("/")) {
            entries.push({
              name: relativePath,
              isFile: !fileEntry.isDirectory,
              isDirectory: fileEntry.isDirectory,
            });
          }
        }
      }

      return ok(entries);
    },

    renameFile: (oldPath: string, newPath: string) => {
      const normalizedOld = normalizePath(oldPath);
      const normalizedNew = normalizePath(newPath);

      const oldEntry = files.get(normalizedOld);
      if (!oldEntry) {
        return err(createError("file-not-found", `File not found: ${oldPath}`));
      }

      const parentCheck = ensureParentExists(normalizedNew);
      if (isErr(parentCheck)) return parentCheck;

      files.set(normalizedNew, oldEntry);
      files.delete(normalizedOld);

      return ok(undefined);
    },
  };
};
