import { extname } from "path";
import { includes } from "@binder/utils";
import { type ParsedYaml, parseYamlDocument } from "./yaml-cst.ts";
import { type ParsedMarkdown, parseMarkdownDocument } from "./markdown.ts";

export const SUPPORTED_MARKDOWN_EXTS = [".md", ".mdx"] as const;
export const SUPPORTED_YAML_EXTS = [".yaml", ".yml"] as const;
export const SUPPORTED_SNAPSHOT_EXTS = [
  ...SUPPORTED_MARKDOWN_EXTS,
  ...SUPPORTED_YAML_EXTS,
] as const;

export type DocumentType = "markdown" | "yaml";
export type ParsedDocument = ParsedYaml | ParsedMarkdown;

export const parseDocument = (
  text: string,
  type: DocumentType,
): ParsedDocument => {
  switch (type) {
    case "markdown":
      return parseMarkdownDocument(text);
    case "yaml":
      return parseYamlDocument(text);
  }
};

export const getDocumentFileType = (path: string): DocumentType | undefined => {
  const ext = extname(path);
  if (!ext) return;
  if (includes(SUPPORTED_MARKDOWN_EXTS, ext)) return "markdown";
  if (includes(SUPPORTED_YAML_EXTS, ext)) return "yaml";
  return;
};

export type FileType = "directory" | DocumentType | "unknown";
export const getFileType = (path: string): FileType => {
  if (path.endsWith("/")) return "directory";
  const ext = extname(path);
  if (!ext) return "directory";
  if (includes(SUPPORTED_MARKDOWN_EXTS, ext)) return "markdown";
  if (includes(SUPPORTED_YAML_EXTS, ext)) return "yaml";
  return "unknown";
};
