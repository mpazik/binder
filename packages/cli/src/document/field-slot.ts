import type {
  Code,
  Effects,
  Extension as MicromarkExtension,
  State,
  Token,
  TokenizeContext,
  Tokenizer,
} from "micromark-util-types";
import type {
  CompileContext,
  Extension as FromMarkdownExtension,
  Handle,
} from "mdast-util-from-markdown";
import type { Literal, Parent, Root, RootContent, Text } from "mdast";
import type { Plugin, Transformer } from "unified";
import type { Node } from "unist";
import { SKIP, visit } from "unist-util-visit";
import { type FieldPath, type RichtextFormat } from "@binder/repo";
import type { ErrorObject } from "@binder/utils";
import { isErr } from "@binder/utils";
import { parseFieldExpression, type Props } from "./field-expression-parser.ts";

export type SlotPosition =
  | "phrase"
  | "line"
  | "block"
  | "section"
  | "part"
  | "document";

export interface FieldSlot<T extends Props = Props> extends Literal {
  type: "fieldSlot";
  value: string;
  path: FieldPath;
  props?: T;
  slotPosition?: SlotPosition;
  parseError?: ErrorObject;
}

declare module "micromark-util-types" {
  interface TokenTypeMap {
    fieldSlot: "fieldSlot";
    fieldSlotMarker: "fieldSlotMarker";
    fieldSlotField: "fieldSlotField";
    escapedLeftBrace: "escapedLeftBrace";
    escapedRightBrace: "escapedRightBrace";
  }
}

const codes = {
  leftBrace: 123, // {
  rightBrace: 125, // }
  newline: 10, // \n
  carriageReturn: 13, // \r
} as const;

const isValidSlotContentChar = (code: Code): boolean => {
  if (code === null) return false;
  if (code === codes.rightBrace) return false;
  if (code === codes.leftBrace) return false;
  if (code === codes.newline) return false;
  if (code === codes.carriageReturn) return false;
  return true;
};

const fieldSlotExtension = (): MicromarkExtension => {
  const tokenizeFieldSlot: Tokenizer = function (
    this: TokenizeContext,
    effects: Effects,
    ok: State,
    nok: State,
  ): State {
    return start;

    function start(code: Code): State | undefined {
      if (code !== codes.leftBrace) return nok(code);
      effects.enter("fieldSlot");
      effects.enter("fieldSlotMarker");
      effects.consume(code);
      return afterFirstBrace;
    }

    function afterFirstBrace(code: Code): State | undefined {
      // {{ becomes escaped left brace
      if (code === codes.leftBrace) {
        effects.exit("fieldSlotMarker");
        effects.exit("fieldSlot");
        return nok(code);
      }
      effects.exit("fieldSlotMarker");
      effects.enter("fieldSlotField");
      return insideField(code);
    }

    function insideField(code: Code): State | undefined {
      if (code === null) {
        effects.exit("fieldSlotField");
        effects.exit("fieldSlot");
        return nok(code);
      }

      if (code === codes.rightBrace) {
        effects.exit("fieldSlotField");
        effects.enter("fieldSlotMarker");
        effects.consume(code);
        effects.exit("fieldSlotMarker");
        effects.exit("fieldSlot");
        return ok;
      }

      if (!isValidSlotContentChar(code)) {
        effects.exit("fieldSlotField");
        effects.exit("fieldSlot");
        return nok(code);
      }

      effects.consume(code);
      return insideField;
    }
  };

  const tokenizeEscapedLeftBrace: Tokenizer = function (
    this: TokenizeContext,
    effects: Effects,
    ok: State,
    nok: State,
  ): State {
    return start;

    function start(code: Code): State | undefined {
      if (code !== codes.leftBrace) return nok(code);
      effects.enter("escapedLeftBrace");
      effects.consume(code);
      return afterFirst;
    }

    function afterFirst(code: Code): State | undefined {
      if (code !== codes.leftBrace) return nok(code);
      effects.consume(code);
      effects.exit("escapedLeftBrace");
      return ok;
    }
  };

  const tokenizeEscapedRightBrace: Tokenizer = function (
    this: TokenizeContext,
    effects: Effects,
    ok: State,
    nok: State,
  ): State {
    return start;

    function start(code: Code): State | undefined {
      if (code !== codes.rightBrace) return nok(code);
      effects.enter("escapedRightBrace");
      effects.consume(code);
      return afterFirst;
    }

    function afterFirst(code: Code): State | undefined {
      if (code !== codes.rightBrace) return nok(code);
      effects.consume(code);
      effects.exit("escapedRightBrace");
      return ok;
    }
  };

  return {
    text: {
      [codes.leftBrace]: [
        { tokenize: tokenizeEscapedLeftBrace },
        { tokenize: tokenizeFieldSlot },
      ],
      [codes.rightBrace]: { tokenize: tokenizeEscapedRightBrace },
    },
  };
};

const fieldSlotFromMarkdown = (): FromMarkdownExtension => {
  const enterFieldSlot: Handle = function (
    this: CompileContext,
    token: Token,
  ): void {
    const node: FieldSlot = {
      type: "fieldSlot",
      value: "",
      path: [],
    };
    this.enter(node as any, token);
  };

  const exitFieldSlotField: Handle = function (
    this: CompileContext,
    token: Token,
  ): void {
    const current = this.stack[this.stack.length - 1] as unknown as FieldSlot;
    const rawValue = this.sliceSerialize(token);
    current.value = rawValue;

    const result = parseFieldExpression(rawValue);
    if (isErr(result)) {
      current.parseError = result.error;
      current.path = rawValue.split(".") as unknown as FieldPath;
    } else {
      current.path = result.data.path;
      if (result.data.props) {
        current.props = result.data.props;
      }
    }
  };

  const exitFieldSlot: Handle = function (
    this: CompileContext,
    token: Token,
  ): void {
    this.exit(token);
  };

  const enterEscapedBrace: Handle = function (
    this: CompileContext,
    token: Token,
  ): void {
    this.enter({ type: "text", value: "" } as any, token);
  };

  const exitEscapedLeftBrace: Handle = function (
    this: CompileContext,
    token: Token,
  ): void {
    const current = this.stack[this.stack.length - 1] as unknown as {
      value: string;
    };
    current.value = "{";
    this.exit(token);
  };

  const exitEscapedRightBrace: Handle = function (
    this: CompileContext,
    token: Token,
  ): void {
    const current = this.stack[this.stack.length - 1] as unknown as {
      value: string;
    };
    current.value = "}";
    this.exit(token);
  };

  return {
    enter: {
      fieldSlot: enterFieldSlot,
      escapedLeftBrace: enterEscapedBrace,
      escapedRightBrace: enterEscapedBrace,
    },
    exit: {
      fieldSlotField: exitFieldSlotField,
      fieldSlot: exitFieldSlot,
      escapedLeftBrace: exitEscapedLeftBrace,
      escapedRightBrace: exitEscapedRightBrace,
    },
  };
};

const POSITION_RANK: Record<SlotPosition, number> = {
  phrase: 0,
  line: 1,
  block: 2,
  section: 3,
  part: 4,
  document: 5,
};

/**
 * Minimum slot rank a single-value field of each richtext format can fit in.
 * `document` needs `part` (rank 4) because document content forbids `---`, so a
 * `---`-bounded slot can unambiguously contain it; but it cannot live inside a
 * `section` slot because internal headings can collide with the section's
 * bounding heading depth.
 */
const RICHTEXT_FORMAT_MIN_RANK: Record<RichtextFormat, number> = {
  word: POSITION_RANK.phrase,
  phrase: POSITION_RANK.phrase,
  line: POSITION_RANK.line,
  block: POSITION_RANK.block,
  section: POSITION_RANK.section,
  document: POSITION_RANK.part,
};

/**
 * For multi-value fields, the item delimiter can collide with the slot's
 * trailing boundary. Bump the minimum slot rank where that happens:
 *   - multi `block`: items separated by blank lines collide with `block` slot
 *     (also blank-line bounded) → needs ≥ `section`.
 *   - multi `document`: items separated by `---` collide with `part` slot
 *     (also `---` bounded) → needs `document`.
 * `section` items are delimited by headers at `sectionDepth + 1`, which nest
 * cleanly inside the section's bounding heading at `sectionDepth`, so no bump.
 */
const RICHTEXT_FORMAT_MIN_RANK_MULTI: Partial<Record<RichtextFormat, number>> =
  {
    block: POSITION_RANK.section,
    document: POSITION_RANK.document,
  };

export const isFormatCompatibleWithPosition = (
  format: RichtextFormat,
  position: SlotPosition,
  allowMultiple = false,
): boolean => {
  const minRank = allowMultiple
    ? (RICHTEXT_FORMAT_MIN_RANK_MULTI[format] ??
      RICHTEXT_FORMAT_MIN_RANK[format])
    : RICHTEXT_FORMAT_MIN_RANK[format];
  return POSITION_RANK[position] >= minRank;
};

const hasNonWhitespaceContent = (child: RootContent): boolean => {
  if (child.type === "text") return (child as Text).value.trim().length > 0;
  return child.type !== "break";
};

const hasNonWhitespaceSiblings = (parent: Parent, slotIndex: number): boolean =>
  parent.children.some(
    (child, i) => i !== slotIndex && hasNonWhitespaceContent(child),
  );

const hasNonWhitespaceAfter = (parent: Parent, slotIndex: number): boolean =>
  parent.children.some(
    (child, i) => i > slotIndex && hasNonWhitespaceContent(child),
  );

const FRONTMATTER_BLOCK_TYPES = ["yaml", "toml"];

const isFrontmatter = (child: RootContent): boolean =>
  FRONTMATTER_BLOCK_TYPES.includes(child.type);

/**
 * Type of the next non-frontmatter block after the given paragraph, or
 * undefined if the paragraph is the last content block.
 */
const getNextContentBlockType = (
  root: Root,
  paragraphIndex: number,
): string | undefined => {
  for (let i = paragraphIndex + 1; i < root.children.length; i++) {
    const child = root.children[i]!;
    if (isFrontmatter(child)) continue;
    return child.type;
  }
  return undefined;
};

/**
 * Type of the previous non-frontmatter block before the given paragraph, or
 * undefined if the paragraph is the first content block.
 */
const getPrevContentBlockType = (
  root: Root,
  paragraphIndex: number,
): string | undefined => {
  for (let i = paragraphIndex - 1; i >= 0; i--) {
    const child = root.children[i]!;
    if (isFrontmatter(child)) continue;
    return child.type;
  }
  return undefined;
};

const hasHeadingBefore = (root: Root, paragraphIndex: number): boolean => {
  for (let i = 0; i < paragraphIndex; i++) {
    if (root.children[i]!.type === "heading") return true;
  }
  return false;
};

/**
 * Classify a root-level paragraph slot. Rules (in order):
 *   1. If the immediately preceding or following non-frontmatter block is a
 *      thematic break (`---`) → `part`. The `---` makes the slot a
 *      rule-bounded region; it dominates any heading scope it sits inside.
 *   2. Else if the immediately following block is a heading → `section`.
 *   3. Else if this is the only content block (frontmatter aside) → `document`.
 *   4. Else if any heading precedes the slot in the file → `section`. A
 *      preceding heading establishes scope for the slot.
 *   5. Else → `block`.
 */
const getRootParagraphSlotPosition = (
  root: Root,
  paragraphIndex: number,
): SlotPosition => {
  const prevType = getPrevContentBlockType(root, paragraphIndex);
  const nextType = getNextContentBlockType(root, paragraphIndex);

  if (prevType === "thematicBreak" || nextType === "thematicBreak")
    return "part";
  if (nextType === "heading") return "section";
  if (prevType === undefined && nextType === undefined) return "document";
  if (hasHeadingBefore(root, paragraphIndex)) return "section";
  return "block";
};

const getSlotPosition = (
  slotIndex: number,
  parent: Parent,
  grandparent: Parent | undefined,
  root: Root,
): SlotPosition => {
  if (hasNonWhitespaceSiblings(parent, slotIndex)) {
    return hasNonWhitespaceAfter(parent, slotIndex) ? "phrase" : "line";
  }
  if (parent.type !== "paragraph") return "line";
  if (!grandparent || grandparent.type !== "root") return "block";

  const paragraphIndex = (grandparent as Root).children.indexOf(
    parent as RootContent,
  );
  if (paragraphIndex === -1) return "block";

  return getRootParagraphSlotPosition(root, paragraphIndex);
};

const transformTree = (): Transformer => {
  return (tree: Node) => {
    const root = tree as Root;

    visit(tree, (node: Node, index, parent) => {
      // Detect slot positions
      if (node.type === "fieldSlot" && typeof index === "number" && parent) {
        const slot = node as FieldSlot;
        let grandparent: Parent | undefined;

        visit(root, (n, _, p) => {
          if (n === parent && p) {
            grandparent = p as Parent;
            return SKIP;
          }
        });

        slot.slotPosition = getSlotPosition(index, parent, grandparent, root);
      }

      // Merge adjacent text records (needed for escaped braces: {{ and }})
      if ("children" in node) {
        const p = node as Parent;
        const newChildren: Node[] = [];

        for (const child of p.children) {
          const last = newChildren[newChildren.length - 1];
          if (child.type === "text" && last?.type === "text") {
            (last as Text).value += (child as Text).value;
          } else {
            newChildren.push(child);
          }
        }

        p.children = newChildren as typeof p.children;
      }
    });
  };
};

export const fieldSlot: Plugin = function (this) {
  const data = this.data();

  data.micromarkExtensions = data.micromarkExtensions ?? [];
  data.fromMarkdownExtensions = data.fromMarkdownExtensions ?? [];

  data.micromarkExtensions.push(fieldSlotExtension());
  data.fromMarkdownExtensions.push(fieldSlotFromMarkdown());

  return transformTree();
};
