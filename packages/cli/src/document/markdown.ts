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
import type { PhrasingContent, Root, RootContent, Text } from "mdast";
import type { Data, Literal, Node } from "unist";
import { remarkViewSlot, type ViewSlot } from "./remark-view-slot.ts";

type SimplifiedNode<T> = T extends { children: infer C }
  ? Omit<T, "children" | "position"> & {
      children: C extends PhrasingContent[]
        ? Text[]
        : C extends Array<infer U>
          ? Array<SimplifiedNode<U>>
          : never;
    }
  : Omit<T, "position">;

export interface BlockRoot extends Omit<Root, "children" | "position"> {
  type: "root";
  children: Array<SimplifiedNode<RootContent>>;
  data?: Data;
}

export type FullAST = Brand<Root, "FullAST">;
export type BlockAST = Brand<BlockRoot, "BlockAST">;

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

const flattenInline = (value: PhrasingContent): any => {
  if ("children" in value && hasInlineChildren(value)) {
    const flattenedValue = renderInlineToMarkdown(value);
    return { ...value, children: [{ type: "text", value: flattenedValue }] };
  }
  if ("children" in value) {
    return { ...value, children: value.children.map(flattenInline) };
  }
  return value;
};

const flattenInlinePreservingSlots = (value: any): any => {
  if (value.type === "viewSlot") return value;

  if ("children" in value && hasInlineChildren(value)) {
    const flattenedChildren: any[] = [];
    let textBuffer = "";

    for (const child of value.children) {
      if (child.type === "viewSlot") {
        if (textBuffer) {
          flattenedChildren.push({ type: "text", value: textBuffer });
          textBuffer = "";
        }
        flattenedChildren.push(child);
      } else {
        textBuffer += extractTextFromInline(child);
      }
    }

    if (textBuffer) {
      flattenedChildren.push({ type: "text", value: textBuffer });
    }

    return { ...value, children: flattenedChildren };
  }

  if ("children" in value && Array.isArray(value.children)) {
    return {
      ...value,
      children: value.children.map(flattenInlinePreservingSlots),
    };
  }

  return value;
};

export const simplifyViewAst = (ast: ViewAST): any => {
  const cleaned = removePosition(ast);
  return {
    ...cleaned,
    children: cleaned.children.map(flattenInlinePreservingSlots),
  };
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

export interface ViewRoot extends Node {
  type: "root";
  children: (ViewSlot | Text)[];
  data?: Data;
}
export type ViewAST = Brand<ViewRoot, "ViewAST">;

export const parseView = (content: string): ViewAST => {
  const processor = unified().use(remarkParse).use(remarkViewSlot);
  return processor.parse(content) as ViewAST;
};

export const astNode = (
  type: string,
  argsOrChildren?: Record<string, unknown> | Node[],
  children?: Node[],
): any => {
  if (Array.isArray(argsOrChildren)) return { type, children: argsOrChildren };
  if (children) return { type, ...argsOrChildren, children };
  if (argsOrChildren) return { type, ...argsOrChildren };
  return { type };
};

export const astTextNode = (text: string): Literal => ({
  type: "text",
  value: text,
});
