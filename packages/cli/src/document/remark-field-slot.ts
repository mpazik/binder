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
import type { Literal, Parent, Text } from "mdast";
import type { Plugin, Transformer } from "unified";
import type { Node } from "unist";
import { visit } from "unist-util-visit";
import type { FieldPath } from "@binder/db";
import type { ErrorObject } from "@binder/utils";
import { isErr } from "@binder/utils";
import { parseFieldExpression, type Props } from "./field-expression-parser.ts";

export interface FieldSlot<T extends Props = Props> extends Literal {
  type: "fieldSlot";
  value: string;
  path: FieldPath;
  props?: T;
  parseError?: ErrorObject;
}

export interface CodeFieldSlot {
  start: number;
  end: number;
  path: FieldPath;
  props?: Props;
}

export interface CodeBlockData {
  fieldSlots?: CodeFieldSlot[];
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

const scanCodeForFieldSlots = (value: string): CodeFieldSlot[] => {
  const slots: CodeFieldSlot[] = [];
  const regex = /(?<!\\)\$\{([^}]+)\}/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(value)) !== null) {
    const content = match[1]!;
    const result = parseFieldExpression(content);

    if (!isErr(result)) {
      slots.push({
        start: match.index,
        end: match.index + match[0].length,
        path: result.data.path,
        ...(result.data.props && { props: result.data.props }),
      });
    }
  }

  return slots;
};

const transformTree = (): Transformer => {
  return (tree: Node) => {
    visit(tree, (node: Node) => {
      // Scan code blocks for ${...} patterns
      if (node.type === "code" || node.type === "inlineCode") {
        const codeNode = node as Literal & { data?: CodeBlockData };
        const value = codeNode.value as string;
        const slots = scanCodeForFieldSlots(value);

        if (slots.length > 0) {
          codeNode.data = codeNode.data ?? {};
          codeNode.data.fieldSlots = slots;
        }
      }

      // Merge adjacent text nodes
      if (!("children" in node)) return;
      const parent = node as Parent;
      const newChildren: Node[] = [];

      for (const child of parent.children) {
        const last = newChildren[newChildren.length - 1];
        if (child.type === "text" && last?.type === "text") {
          (last as Text).value += (child as Text).value;
        } else {
          newChildren.push(child);
        }
      }

      parent.children = newChildren as typeof parent.children;
    });
  };
};

export const remarkFieldSlot: Plugin = function (this) {
  const data = this.data();

  data.micromarkExtensions = data.micromarkExtensions ?? [];
  data.fromMarkdownExtensions = data.fromMarkdownExtensions ?? [];

  data.micromarkExtensions.push(fieldSlotExtension());
  data.fromMarkdownExtensions.push(fieldSlotFromMarkdown());

  return transformTree();
};
