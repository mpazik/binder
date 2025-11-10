/**
 * Micromark extension for {field} syntax in view templates
 *
 * Architecture:
 * 1. viewSlotExtension(): Creates micromark syntax extension that tokenizes {field} during parsing
 * 2. viewSlotFromMarkdown(): Creates mdast-util-from-markdown extension that converts tokens to AST nodes
 * 3. remarkViewSlot: Remark plugin that registers both extensions
 */
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
import type { Literal, Text } from "mdast";
import type { Plugin } from "unified";
import type { Data, Node } from "unist";

export interface ViewSlot extends Literal {
  type: "viewSlot";
  value: string;
  data?: {
    hName: string;
    hProperties: {
      className: string;
    };
  };
}

declare module "micromark-util-types" {
  interface TokenTypeMap {
    viewSlot: "viewSlot";
    viewSlotMarker: "viewSlotMarker";
    viewSlotField: "viewSlotField";
  }
}

const codes = {
  leftBrace: 123, // {
  rightBrace: 125, // }
  hyphen: 45, // -
  underscore: 95, // _
  dot: 46, // .
} as const;

const isValidFieldChar = (code: Code): boolean => {
  if (code === null) return false;
  // a-z (97-122), A-Z (65-90), 0-9 (48-57), - (45), _ (95), . (46)
  return (
    (code >= 97 && code <= 122) || // a-z
    (code >= 65 && code <= 90) || // A-Z
    (code >= 48 && code <= 57) || // 0-9
    code === codes.hyphen || // -
    code === codes.underscore || // _
    code === codes.dot // .
  );
};

const viewSlotExtension = (): MicromarkExtension => {
  const tokenize: Tokenizer = function (
    this: TokenizeContext,
    effects: Effects,
    ok: State,
    nok: State,
  ): State {
    return start;

    function start(code: Code): State | undefined {
      if (code !== codes.leftBrace) return nok(code);
      effects.enter("viewSlot");
      effects.enter("viewSlotMarker");
      effects.consume(code);
      effects.exit("viewSlotMarker");
      effects.enter("viewSlotField");
      return insideField;
    }

    function insideField(code: Code): State | undefined {
      if (code === null) {
        effects.exit("viewSlotField");
        effects.exit("viewSlot");
        return nok(code);
      }

      if (code === codes.rightBrace) {
        effects.exit("viewSlotField");
        effects.enter("viewSlotMarker");
        effects.consume(code);
        effects.exit("viewSlotMarker");
        effects.exit("viewSlot");
        return ok;
      }

      if (!isValidFieldChar(code)) {
        effects.exit("viewSlotField");
        effects.exit("viewSlot");
        return nok(code);
      }

      effects.consume(code);
      return insideField;
    }
  };

  return {
    text: {
      [codes.leftBrace]: { tokenize },
    },
  };
};

const viewSlotFromMarkdown = (): FromMarkdownExtension => {
  const enterViewSlot: Handle = function (
    this: CompileContext,
    token: Token,
  ): void {
    const node: ViewSlot = {
      type: "viewSlot",
      value: "",
      data: {
        hName: "span",
        hProperties: {
          className: "view-slot",
        },
      },
    };
    this.enter(node as any, token);
  };

  const exitViewSlotField: Handle = function (
    this: CompileContext,
    token: Token,
  ): void {
    const current = this.stack[this.stack.length - 1];
    if ("value" in current && typeof current.value === "string") {
      current.value = this.sliceSerialize(token);
    }
  };

  const exitViewSlot: Handle = function (
    this: CompileContext,
    token: Token,
  ): void {
    this.exit(token);
  };

  return {
    enter: {
      viewSlot: enterViewSlot,
    },
    exit: {
      viewSlotField: exitViewSlotField,
      viewSlot: exitViewSlot,
    },
  };
};

export const remarkViewSlot: Plugin = function (this) {
  const data = this.data();

  data.micromarkExtensions = data.micromarkExtensions ?? [];
  data.fromMarkdownExtensions = data.fromMarkdownExtensions ?? [];

  data.micromarkExtensions.push(viewSlotExtension());
  data.fromMarkdownExtensions.push(viewSlotFromMarkdown());
};
