import fs, { existsSync, readdirSync, statSync } from "fs";
import { readFile } from "fs/promises";
import path, { join } from "path";
import { Glob } from "bun";

export type FileWithContent = { content: string; filePath: string };

export type MatchOptions = {
  include?: string[];
  exclude?: string[];
};

export type TreeOptions = MatchOptions & {
  maxDepth?: number;
};

const DEFAULT_IGNORE_PATTERNS = [
  "node_modules",
  ".git",
  ".DS_Store",
  "dist",
  "build",
  ".vscode",
  ".idea",
  "*.log",
  ".env*",
  "target",
];

export type DirectoryNode =
  | string
  | { name: string; children: DirectoryNode[] };

const isMatchingPath = (
  filePath: string,
  include: string[],
  exclude: string[],
): boolean => {
  const fileName = path.basename(filePath);
  const allExcludePatterns = [...DEFAULT_IGNORE_PATTERNS, ...exclude];

  if (allExcludePatterns.length > 0) {
    const shouldExclude = allExcludePatterns.some((pattern) => {
      const glob = new Glob(pattern);
      return glob.match(fileName) || glob.match(filePath);
    });
    if (shouldExclude) return false;
  }

  if (include.length === 0) return true;
  return include.some((pattern) => {
    const glob = new Glob(pattern);
    return glob.match(fileName) || glob.match(filePath);
  });
};

const shouldIncludeDirectory = (
  dirPath: string,
  _include: string[],
  exclude: string[],
): boolean => {
  const dirName = path.basename(dirPath);
  const allExcludePatterns = [...DEFAULT_IGNORE_PATTERNS, ...exclude];

  if (allExcludePatterns.length > 0) {
    const shouldExclude = allExcludePatterns.some((pattern) => {
      const glob = new Glob(pattern);
      return glob.match(dirName) || glob.match(dirPath);
    });
    if (shouldExclude) return false;
  }

  return true;
};

export const createDirectoryStructure = (
  rootPath: string,
  options: TreeOptions = {},
): DirectoryNode => {
  const { maxDepth = 12, include = [], exclude = [] } = options;
  const normalizedRoot = path.resolve(rootPath);

  const hasVisibleContent = (dirPath: string): boolean => {
    try {
      const items = fs.readdirSync(dirPath, { withFileTypes: true });
      return items.some((item) => {
        const itemPath = path.join(dirPath, item.name);

        if (item.isDirectory()) {
          return (
            shouldIncludeDirectory(itemPath, include, exclude) &&
            hasVisibleContent(itemPath)
          );
        } else {
          return isMatchingPath(itemPath, include, exclude);
        }
      });
    } catch {
      return false;
    }
  };

  const traverse = (dirPath: string, depth: number = 0): DirectoryNode[] => {
    if (depth >= maxDepth) return [];

    try {
      const items = fs.readdirSync(dirPath, { withFileTypes: true });

      const filteredItems = items.filter((item) => {
        const itemPath = path.join(dirPath, item.name);

        if (item.isDirectory()) {
          return (
            shouldIncludeDirectory(itemPath, include, exclude) &&
            hasVisibleContent(itemPath)
          );
        } else {
          return isMatchingPath(itemPath, include, exclude);
        }
      });

      filteredItems.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

      return filteredItems.map((item) => {
        const itemPath = path.join(dirPath, item.name);

        if (item.isDirectory()) {
          return {
            name: item.name,
            children: traverse(itemPath, depth + 1),
          };
        }
        return item.name;
      });
    } catch (error) {
      console.error(`Error reading directory ${dirPath}: ${error}`);
      return [];
    }
  };

  return {
    name: path.basename(normalizedRoot),
    children: traverse(normalizedRoot),
  };
};

export const flattenDirectoryStructure = (
  node: DirectoryNode | string,
  basePath: string = "",
): string[] => {
  if (typeof node === "string") {
    return [path.join(basePath, node)];
  }

  const files: string[] = [];

  const traverse = (
    currentNode: DirectoryNode,
    currentPath: string,
    isRoot: boolean = false,
  ): void => {
    if (typeof currentNode === "string") {
      files.push(path.join(currentPath, currentNode));
    } else {
      const dirPath = isRoot
        ? currentPath
        : path.join(currentPath, currentNode.name);
      currentNode.children.forEach((child) => traverse(child, dirPath, false));
    }
  };

  traverse(node, basePath, true);
  return files;
};

export type FileInput = string | string[];

export const matchFiles = (
  input: FileInput,
  options: MatchOptions = {},
): string[] => {
  if (Array.isArray(input)) {
    return input
      .map((filePath) => path.resolve(filePath))
      .filter((filePath) =>
        isMatchingPath(filePath, options.include ?? [], options.exclude ?? []),
      );
  }

  const inputPath = path.isAbsolute(input) ? input : path.resolve(input);

  if (existsSync(inputPath) && statSync(inputPath).isFile()) {
    // If it's a file, check if it matches the filters and return it
    const matches = isMatchingPath(
      inputPath,
      options.include ?? [],
      options.exclude ?? [],
    );
    return matches ? [inputPath] : [];
  }

  const structure = createDirectoryStructure(inputPath, options);
  return flattenDirectoryStructure(structure, inputPath);
};

export const loadFile = async (
  filePath: string,
  cwd: string,
  transformer?: (content: string) => string,
): Promise<string> => {
  const fullPath = path.isAbsolute(filePath)
    ? filePath
    : filePath.startsWith(cwd)
      ? filePath
      : path.join(cwd, filePath);

  const content = await readFile(fullPath, "utf-8");
  return transformer ? transformer(content) : content;
};

export const loadFiles = async (
  filePaths: string[],
  cwd: string,
  transformer?: (content: string) => string,
): Promise<FileWithContent[]> => {
  const results = await Promise.all(
    filePaths.map(async (filePath) => {
      try {
        const content = await loadFile(filePath, cwd, transformer);
        return { content, filePath };
      } catch (error) {
        console.error(`Error loading file ${filePath}:`, error);
        return null;
      }
    }),
  );
  return results.filter((result): result is FileWithContent => result !== null);
};

export function getAvailableModules(
  includeRoot = true,
): readonly [string, ...string[]] {
  const packagesDir = join(process.cwd(), "packages");
  const modules = includeRoot ? ["all"] : [];

  if (existsSync(packagesDir)) {
    try {
      const entries = readdirSync(packagesDir);
      for (const entry of entries) {
        const entryPath = join(packagesDir, entry);
        if (
          statSync(entryPath).isDirectory() &&
          existsSync(join(entryPath, "package.json"))
        ) {
          modules.push(entry);
        }
      }
    } catch (error) {
      console.warn("Could not scan packages directory:", error);
    }
  }
  if (!modules.length) {
    console.warn("No modules found in packages directory.");
  }

  return modules as [string, ...string[]];
}
