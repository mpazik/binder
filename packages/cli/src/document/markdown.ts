/**
 * Markdown parsing functions do not return Result types because the CommonMark spec
 * guarantees that any character sequence is valid markdown. Parsers never throw errors
 * on malformed syntax - they simply parse it as literal text records.
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import remarkParseFrontmatter from "remark-parse-frontmatter";
import { type Options } from "remark-stringify";
import { toMarkdown } from "mdast-util-to-markdown";
import { gfmToMarkdown } from "mdast-util-gfm";
import { frontmatterToMarkdown } from "mdast-util-frontmatter";
import { type Brand, includes } from "@binder/utils";
import type { Nodes, PhrasingContent, Root, RootContent, Text } from "mdast";
import type { Data, Literal, Node } from "unist";
import { type FieldPath } from "@binder/repo";
import { type FieldSlot } from "./field-slot.ts";
import type { ViewAST } from "./view.ts";

type ExtendedNode = Nodes | FieldSlot;

export type SimplifiedViewInlineChild = FieldSlot | Text;

export type SimplifiedViewBlockChild = Omit<
  RootContent,
  "children" | "position"
> & {
  children?: SimplifiedViewInlineChild[];
};

export interface SimplifiedViewRoot extends Node {
  type: "root";
  children: SimplifiedViewBlockChild[];
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
  rule: "-",
  join: [
    (left, right) => {
      // Prevent blank line between paragraph and list when the paragraph text
      // naturally flows into the list (e.g., "Focus areas:\n- Item 1")
      if (left.type === "paragraph" && right.type === "list") return 0;
      return undefined;
    },
  ],
};

const SLOT_PLACEHOLDER = "\u0000SLOT\u0000";

const childrenText = (
  node: { children: ExtendedNode[] },
  slotAware: boolean,
): string =>
  node.children.map((c) => extractTextFromInline(c, slotAware)).join("");

const extractTextFromInline = (
  node: ExtendedNode,
  slotAware: boolean = false,
): string => {
  if (node.type === "text") return node.value || "";
  if (node.type === "fieldSlot") return SLOT_PLACEHOLDER;
  if (node.type === "inlineCode") return `\`${node.value || ""}\``;
  if (node.type === "strong") return `**${childrenText(node, slotAware)}**`;
  if (node.type === "emphasis") return `_${childrenText(node, slotAware)}_`;
  if (node.type === "delete") return `~~${childrenText(node, slotAware)}~~`;
  if (node.type === "link") {
    const rawUrl = node.url || "";
    const url = slotAware
      ? rawUrl.replace(/\{[\w.-]+\}/g, SLOT_PLACEHOLDER)
      : rawUrl;
    return `[${childrenText(node, slotAware)}](${url})`;
  }
  if ("children" in node && Array.isArray(node.children))
    return node.children
      .map((c) => extractTextFromInline(c, slotAware))
      .join("");
  return "";
};

export const renderAstToMarkdown = (ast: Nodes): string =>
  toMarkdown(ast, {
    ...defaultRenderOptions,
    extensions: [gfmToMarkdown(), frontmatterToMarkdown("yaml")],
  });

/**
 * Render a simplified AST (produced by simplifyAst) back to markdown without
 * escaping text node content. simplifyAst flattens inline formatting (links,
 * emphasis, etc.) into raw markdown strings inside Text nodes. The standard
 * renderAstToMarkdown would escape those strings, corrupting the content.
 * This variant emits text node values verbatim.
 */
export const renderSimplifiedAstToMarkdown = (ast: Nodes): string =>
  toMarkdown(ast, {
    ...defaultRenderOptions,
    extensions: [gfmToMarkdown(), frontmatterToMarkdown("yaml")],
    handlers: {
      text(node: Text) {
        return node.value;
      },
    },
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

const isInline = (type: string): boolean => includes(inlineTypes, type);

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
    const flattenedValue = extractTextFromInline(value);
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
    } else if (node.type === "link") {
      // Collect child field slots first (link text comes before URL in serialized form)
      for (const child of node.children) {
        traverse(child);
      }
      // Create field slots for {placeholder} patterns in the URL
      for (const match of (node.url || "").matchAll(/\{([\w.-]+)\}/g)) {
        const path = match[1]!.split(".") as FieldPath;
        slots.push({ type: "fieldSlot", value: match[1]!, path });
      }
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
      .map((child: ExtendedNode) => extractTextFromInline(child, true))
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

export const simplifyViewAst = (ast: ViewAST): SimplifiedViewRoot => {
  const cleaned = removePosition(ast);
  return {
    ...cleaned,
    children: cleaned.children.map((child) =>
      flattenInlinePreservingSlots(child),
    ) as SimplifiedViewBlockChild[],
  } as SimplifiedViewRoot;
};

export const parseAst = (content: string): FullAST =>
  unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkFrontmatter)
    .use(remarkParseFrontmatter)
    .parse(content) as FullAST;

export const simplifyAst = (ast: FullAST): BlockAST => {
  const cleaned = removePosition(ast);
  return {
    ...cleaned,
    children: cleaned.children.map(flattenInline),
  } as unknown as BlockAST;
};

export const parseMarkdown = (content: string): BlockAST =>
  simplifyAst(parseAst(content));

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

export const parseMarkdownDocument = (content: string): ParsedMarkdown => ({
  root: parseAst(content),
});
