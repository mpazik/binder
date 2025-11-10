/**
 * Markdown parsing functions do not return Result types because the CommonMark spec
 * guarantees that any character sequence is valid markdown. Parsers never throw errors
 * on malformed syntax - they simply parse it as literal text nodes.
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkFrontmatter from "remark-frontmatter";
import remarkParseFrontmatter from "remark-parse-frontmatter";
import remarkDirective from "remark-directive";
import { type Options } from "remark-stringify";
import { toMarkdown } from "mdast-util-to-markdown";
import { directiveToMarkdown } from "mdast-util-directive";
import { type Brand } from "@binder/utils";
import type { Root, RootContent } from "mdast";

export type FullAST = Brand<Root, "FullAST">;
export type BlockAST = Brand<Root, "BlockAST">;

export const defaultRenderOptions: Options = {
  emphasis: "_",
  bullet: "-",
};

const extractTextFromInline = (node: any): string => {
  if (node.type === "text") {
    return node.value || "";
  }
  if (node.type === "strong") {
    const innerText = node.children.map(extractTextFromInline).join("");
    return `**${innerText}**`;
  }
  if (node.type === "emphasis") {
    const innerText = node.children.map(extractTextFromInline).join("");
    return `_${innerText}_`;
  }
  if (node.type === "inlineCode") {
    return `\`${node.value || ""}\``;
  }
  if (node.type === "delete") {
    const innerText = node.children.map(extractTextFromInline).join("");
    return `~~${innerText}~~`;
  }
  if (node.type === "link") {
    const text = node.children.map(extractTextFromInline).join("");
    return `[${text}](${node.url || ""})`;
  }
  if ("children" in node && Array.isArray(node.children)) {
    return node.children.map(extractTextFromInline).join("");
  }
  return "";
};

const renderInlineToMarkdown = (node: RootContent): string => {
  return extractTextFromInline(node);
};

export const renderAstToMarkdown = (ast: FullAST | BlockAST): string => {
  const markdown = toMarkdown(ast, {
    ...defaultRenderOptions,
    extensions: [directiveToMarkdown()],
  });

  return markdown
    .replace(/\\(\*)/g, "$1")
    .replace(/\\(_)/g, "$1")
    .replace(/\\(`)/g, "$1")
    .replace(/\\(\[)/g, "$1")
    .replace(/\\(\])/g, "$1")
    .replace(/\\(~)/g, "$1");
};

const isInline = (type: string): boolean =>
  ["strong", "emphasis", "link", "inlineCode", "delete", "html"].includes(type);

const hasInlineChildren = (node: any): boolean =>
  "children" in node &&
  node.children.some((child: any) => isInline(child.type));

export const removePosition = (obj: any): any => {
  if (Array.isArray(obj)) {
    return obj.map(removePosition);
  }
  if (obj && typeof obj === "object") {
    const { position, ...rest } = obj;
    for (const key in rest) {
      rest[key] = removePosition(rest[key]);
    }
    return rest;
  }
  return obj;
};

const flattenInline = (node: RootContent): any => {
  if ("children" in node && hasInlineChildren(node)) {
    const flattenedValue = renderInlineToMarkdown(node);
    return { ...node, children: [{ type: "text", value: flattenedValue }] };
  }
  if ("children" in node) {
    return { ...node, children: node.children.map(flattenInline) };
  }
  return node;
};

export const parseAst = (content: string): FullAST => {
  const processor = unified()
    .use(remarkParse)
    .use(remarkDirective)
    .use(remarkFrontmatter)
    .use(remarkParseFrontmatter);
  return processor.parse(content) as FullAST;
};

export const simplifyAst = (ast: FullAST): BlockAST => {
  const cleaned = removePosition(ast);
  return {
    ...cleaned,
    children: cleaned.children.map(flattenInline),
  };
};

export const parseMarkdown = (content: string): BlockAST => {
  const ast = parseAst(content);
  return simplifyAst(ast);
};
