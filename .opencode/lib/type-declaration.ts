import path from "path";
import {
  type FileInput,
  type FileWithContent,
  loadFiles,
  matchFiles,
  type MatchOptions,
} from "./file.ts";

export { type FileWithContent };

export const wrapInTag = (
  tag: string,
  content: string,
  options: {
    newLine?: boolean;
    args?: Record<string, string>;
  } = {},
): string => {
  const argsEntries = options.args ? Object.entries(options.args) : [];
  const newLine = options.newLine ?? true;

  const argsString =
    argsEntries.length > 0
      ? " " + argsEntries.map(([key, value]) => `${key}="${value}"`).join(" ")
      : "";

  const openTag = `${tag}${argsString}`;

  return newLine
    ? `<${openTag}>\n${content}\n</${tag}>`
    : `<${openTag}>${content}</${tag}>`;
};

export const mapSourceToDeclarationPath = (
  sourceFilePath: string,
  cwd: string,
): string | null => {
  if (sourceFilePath.endsWith(".d.ts")) {
    return sourceFilePath;
  }
  const rel = path.relative(cwd, sourceFilePath);

  if ((!rel.endsWith(".ts") && !rel.endsWith(".tsx")) || !rel.includes("src")) {
    return null;
  }

  const declRel = rel
    .replace(`${path.sep}src${path.sep}`, `${path.sep}dist${path.sep}`)
    .replace(/\.(ts|tsx)$/, ".d.ts");
  return path.join(cwd, declRel);
};

const mapDeclarationToSourcePath = (
  declarationFilePath: string,
  input: string,
): string => {
  const sourcePath = declarationFilePath
    .replace(`${path.sep}dist${path.sep}`, `${path.sep}src${path.sep}`)
    .replace(/\.d\.ts$/, ".ts");

  return path.relative(input, sourcePath);
};

const cleanDeclarationContent = (content: string): string => {
  return content.replace(/export declare /g, "").replace(/;$/gm, "");
};

export const loadTypeDeclarations = async (
  input: FileInput,
  cwd: string,
  options: MatchOptions = {},
): Promise<FileWithContent[]> => {
  // For single file paths, don't add default include patterns
  const inputPath = Array.isArray(input) ? input[0] : input;
  const isFilePath =
    !Array.isArray(input) &&
    (inputPath.endsWith(".ts") ||
      inputPath.endsWith(".tsx") ||
      inputPath.endsWith(".d.ts"));

  if (!isFilePath && (!options.include || options.include.length === 0)) {
    options.include = ["*.ts", "*.tsx"];
  }

  const sourceFiles = matchFiles(input, options);
  const declarationPaths = sourceFiles
    .map((file) => mapSourceToDeclarationPath(file, cwd))
    .filter((it): it is string => it !== null);

  return await loadFiles(declarationPaths, cwd, cleanDeclarationContent).then(
    (files) =>
      files
        .filter(
          (it) => it.content !== "" || it.content.startsWith("export {};"),
        )
        .map((file) => ({
          ...file,
          filePath: mapDeclarationToSourcePath(file.filePath, inputPath),
        })),
  );
};

export const loadTypeDeclarationsForPrompt = async (
  input: FileInput,
  cwd: string,
  options: MatchOptions = {},
): Promise<string> => {
  const declarations = await loadTypeDeclarations(input, cwd, options);
  return declarations
    .map((declaration) =>
      wrapInTag("type-declaration", declaration.content, {
        args: { filePath: declaration.filePath },
      }),
    )
    .join("\n");
};

const extractFileHeader = (content: string): string => {
  const headerLines: string[] = [];
  let position = 0;
  let inBlockComment = false;
  let hasSeenBlockComment = false;

  while (position < content.length) {
    const lineEnd = content.indexOf("\n", position);
    const line =
      lineEnd === -1
        ? content.slice(position)
        : content.slice(position, lineEnd);
    const trimmed = line.trim();

    if (trimmed.startsWith("/**")) {
      inBlockComment = true;
      hasSeenBlockComment = true;
      headerLines.push(line);
      if (trimmed.endsWith("*/")) {
        inBlockComment = false;
        break;
      }
    } else if (inBlockComment) {
      headerLines.push(line);
      if (trimmed.endsWith("*/")) {
        inBlockComment = false;
        break;
      }
    } else if (
      trimmed === "" &&
      (hasSeenBlockComment || headerLines.length > 0)
    ) {
      headerLines.push(line);
    } else if (trimmed.startsWith("import ") || trimmed.startsWith("export ")) {
      break;
    } else if (
      trimmed !== "" &&
      !hasSeenBlockComment &&
      headerLines.length === 0
    ) {
      break;
    } else if (trimmed !== "" && hasSeenBlockComment) {
      break;
    }

    if (lineEnd === -1) break;
    position = lineEnd + 1;
  }

  return headerLines.join("\n");
};

export const loadFileHeaders = async (
  input: FileInput,
  cwd: string,
  options: MatchOptions = {},
): Promise<FileWithContent[]> => {
  if (!options.include || options.include.length === 0) {
    options.include = ["*.ts"];
  }
  const sourceFiles = matchFiles(input, options);
  return await loadFiles(sourceFiles, cwd, extractFileHeader).then((headers) =>
    headers.filter((header) => header.content !== ""),
  );
};

export const loadFileHeadersForPrompt = async (
  input: FileInput,
  cwd: string,
  options: MatchOptions = {},
): Promise<string> => {
  const headers = await loadFileHeaders(input, cwd, options);
  return headers
    .map((header) =>
      wrapInTag("file-header", header.content, {
        args: { filePath: header.filePath },
      }),
    )
    .join("\n");
};
