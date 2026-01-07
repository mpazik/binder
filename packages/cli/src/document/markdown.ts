/**
 * Markdown parsing functions do not return Result types because the CommonMark spec
 * guarantees that any character sequence is valid markdown. Parsers never throw errors
 * on malformed syntax - they simply parse it as literal text nodes.
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import remarkParseFrontmatter from "remark-parse-frontmatter";
import remarkDirective from "remark-directive";
import { type Options } from "remark-stringify";
import { toMarkdown } from "mdast-util-to-markdown";
import { directiveToMarkdown } from "mdast-util-directive";
import { gfmToMarkdown } from "mdast-util-gfm";
import { type Brand } from "@binder/utils";
import type { Nodes, PhrasingContent, Root, RootContent, Text } from "mdast";
import type { Data, Literal, Node } from "unist";
import { type FieldSlot } from "./remark-field-slot.ts";
import type { TemplateAST } from "./template.ts";

type ExtendedNode = Nodes | FieldSlot;

interface SimplifiedViewRoot extends Node {
  type: "root";
  children: Array<FieldSlot | Text>;
}

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

const SLOT_PLACEHOLDER = "\u0000SLOT\u0000";

const extractTextFromInline = (node: ExtendedNode): string => {
  if (node.type === "text") {
    return node.value || "";
  }
  if (node.type === "fieldSlot") {
    return SLOT_PLACEHOLDER;
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

export const renderAstToMarkdown = (ast: Nodes): string =>
  toMarkdown(ast, {
    ...defaultRenderOptions,
    extensions: [gfmToMarkdown(), directiveToMarkdown()],
  });

const inlineTypes = [
  "strong",
  "emphasis",
  "link",
  "inlineCode",
  "delete",
  "html",
  "fieldSlot",
] as const;

type InlineType = (typeof inlineTypes)[number];

const isInline = (type: string): type is InlineType =>
  inlineTypes.includes(type as InlineType);

const hasInlineChildren = (node: ExtendedNode): boolean =>
  "children" in node &&
  node.children.some((child: ExtendedNode) => isInline(child.type));

export const removePosition = <T>(obj: T): T => {
  if (Array.isArray(obj)) {
    return obj.map(removePosition) as T;
  }
  if (obj && typeof obj === "object") {
    const { position, ...rest } = obj as Record<string, unknown>;
    for (const key in rest) {
      rest[key] = removePosition(rest[key]);
    }
    return rest as T;
  }
  return obj;
};

const flattenInline = (value: RootContent): SimplifiedNode<RootContent> => {
  if ("children" in value && hasInlineChildren(value)) {
    const flattenedValue = renderInlineToMarkdown(value);
    return {
      ...value,
      children: [{ type: "text", value: flattenedValue }],
    } as SimplifiedNode<RootContent>;
  }
  if ("children" in value) {
    return {
      ...value,
      children: value.children.map((c) => flattenInline(c as RootContent)),
    } as SimplifiedNode<RootContent>;
  }
  return value;
};

const splitByPlaceholder = (
  text: string,
  slots: FieldSlot[],
): Array<FieldSlot | Text> => {
  const parts = text.split(SLOT_PLACEHOLDER);
  const result: Array<FieldSlot | Text> = [];

  for (let i = 0; i < parts.length; i++) {
    if (parts[i]) {
      result.push({ type: "text", value: parts[i] });
    }
    if (i < slots.length) {
      result.push(slots[i]!);
    }
  }

  return result;
};

const extractSlots = (children: ExtendedNode[]): FieldSlot[] => {
  const slots: FieldSlot[] = [];

  const traverse = (node: ExtendedNode): void => {
    if (node.type === "fieldSlot") {
      slots.push(node);
    } else if ("children" in node && Array.isArray(node.children)) {
      for (const child of node.children) {
        traverse(child);
      }
    }
  };

  for (const child of children) {
    traverse(child);
  }

  return slots;
};

const flattenInlinePreservingSlots = (value: ExtendedNode): ExtendedNode => {
  if (value.type === "fieldSlot") return value;

  if ("children" in value && hasInlineChildren(value)) {
    const textWithPlaceholders = value.children
      .map((child: ExtendedNode) => extractTextFromInline(child))
      .join("");
    const slots = extractSlots(value.children);

    return {
      ...value,
      children: splitByPlaceholder(textWithPlaceholders, slots),
    } as ExtendedNode;
  }

  if ("children" in value && Array.isArray(value.children)) {
    return {
      ...value,
      children: value.children.map((child: ExtendedNode) =>
        flattenInlinePreservingSlots(child),
      ),
    } as ExtendedNode;
  }

  return value;
};

export const simplifyViewAst = (ast: TemplateAST): SimplifiedViewRoot => {
  const cleaned = removePosition(ast);
  return {
    ...cleaned,
    children: cleaned.children.map((child) =>
      flattenInlinePreservingSlots(child),
    ) as Array<FieldSlot | Text>,
  } as SimplifiedViewRoot;
};

export const parseAst = (content: string): FullAST => {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
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
  } as unknown as BlockAST;
};

export const parseMarkdown = (content: string): BlockAST => {
  const ast = parseAst(content);
  return simplifyAst(ast);
};

export const astNode = (
  type: string,
  argsOrChildren?: Record<string, unknown> | Node[],
  children?: Node[],
): Node => {
  if (Array.isArray(argsOrChildren))
    return { type, children: argsOrChildren } as Node;
  if (children) return { type, ...argsOrChildren, children } as Node;
  if (argsOrChildren) return { type, ...argsOrChildren } as Node;
  return { type } as Node;
};

export const astTextNode = (text: string): Literal => ({
  type: "text",
  value: text,
});

export type ParsedMarkdown = {
  root: FullAST;
};

export const parseMarkdownDocument = (content: string): ParsedMarkdown => {
  return {
    root: parseAst(content),
  };
};
