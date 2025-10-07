import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkFrontmatter from "remark-frontmatter";
import remarkParseFrontmatter from "remark-parse-frontmatter";
import remarkStringify, { type Options } from "remark-stringify";
import {
  type Brand,
  createError,
  isErr,
  ok,
  type Result,
  tryCatch,
} from "@binder/utils";
import type { Root, RootContent } from "mdast";

export type FullAST = Brand<Root, "FullAST">;
export type SlimAST = Brand<Root, "SimplifiedAST">;

export const defaultRenderOptions: Options = {
  emphasis: "_",
  bullet: "-",
};

const renderInlineToMarkdown = (
  node: RootContent,
  options: Options = defaultRenderOptions,
): string => {
  const processor = unified().use(remarkStringify, options);
  return processor.stringify({ type: "root", children: [node] }).trim();
};

export const renderAstToMarkdown = (ast: FullAST | SlimAST): string => {
  const processor = unified().use(remarkStringify, defaultRenderOptions);
  return processor.stringify(ast);
};

const isInline = (type: string): boolean =>
  ["strong", "emphasis", "link", "inlineCode", "delete", "html"].includes(type);

const hasInlineChildren = (node: any): boolean =>
  "children" in node &&
  node.children.some((child: any) => isInline(child.type));

const removePosition = (obj: any): any => {
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

export const parseAst = (content: string): Result<any> =>
  tryCatch(
    () => {
      const processor = unified()
        .use(remarkParse)
        .use(remarkFrontmatter)
        .use(remarkParseFrontmatter);
      return processor.parse(content);
    },
    (error) =>
      createError("parse_error", "Failed to parse markdown", { error }),
  );

export const simplifyAst = (ast: FullAST): SlimAST => {
  const cleaned = removePosition(ast);
  return {
    ...cleaned,
    children: cleaned.children.map(flattenInline),
  };
};

export const parseMarkdown = (content: string): Result<SlimAST> => {
  const astResult = parseAst(content);
  if (isErr(astResult)) return astResult;
  return ok(simplifyAst(astResult.data));
};
