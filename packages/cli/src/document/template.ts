import {
  type Brand,
  createError,
  err,
  type ErrorObject,
  isErr,
  ok,
  type Result,
} from "@binder/utils";
import {
  type EntitySchema,
  type FieldKey,
  type FieldsetNested,
  getFieldDefNested,
  getNestedValue,
  parseFieldValue,
  setNestedValue,
} from "@binder/db";
import type { Nodes, Parent, Root, Text } from "mdast";
import { visit } from "unist-util-visit";
import type { Data, Node } from "unist";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { type FieldSlot, remarkFieldSlot } from "./remark-field-slot.ts";
import {
  type BlockAST,
  renderAstToMarkdown,
  simplifyViewAst,
} from "./markdown.ts";
import { isBlockLevelField, renderFieldValue } from "./field-render.ts";

type SimplifiedViewNode = FieldSlot | Text;

export interface TemplateRoot extends Node {
  type: "root";
  children: (FieldSlot | Text)[];
  data?: Data;
}

export type TemplateAST = Brand<TemplateRoot, "TemplateAST">;

export const parseTemplate = (content: string): TemplateAST => {
  const processor = unified().use(remarkParse).use(remarkFieldSlot);
  return processor.parse(content) as TemplateAST;
};

const isSoleChildOfParagraph = (
  parent: Parent | undefined,
  index: number | undefined,
): boolean =>
  parent?.type === "paragraph" && parent.children.length === 1 && index === 0;

export const renderTemplate = (
  schema: EntitySchema,
  view: TemplateAST,
  fieldset: FieldsetNested,
): Result<string> => {
  const ast = structuredClone(view) as Root;

  // Track paragraphs to replace with block content (paragraph -> replacement blocks)
  const blockReplacements = new Map<Parent, Nodes[]>();

  visit(
    ast,
    "fieldSlot",
    (
      node: FieldSlot,
      index: number | undefined,
      parent: Parent | undefined,
    ) => {
      if (!parent || typeof index !== "number") return;

      const fieldPath = node.path;
      const value = getNestedValue(fieldset, fieldPath);
      const fieldDef = getFieldDefNested(schema, fieldPath);

      if (!fieldDef) {
        parent.children[index] = { type: "text", value: "" };
        return;
      }

      const renderedNodes = renderFieldValue(value, fieldDef);

      if (
        isBlockLevelField(fieldDef) &&
        isSoleChildOfParagraph(parent, index)
      ) {
        blockReplacements.set(parent, renderedNodes);
        return;
      }

      parent.children.splice(
        index,
        1,
        ...(renderedNodes as typeof parent.children),
      );
    },
  );

  if (blockReplacements.size > 0 && "children" in ast) {
    const newChildren: typeof ast.children = [];
    for (const child of ast.children) {
      const replacement = blockReplacements.get(child as Parent);
      if (replacement) {
        newChildren.push(...(replacement as typeof ast.children));
      } else {
        newChildren.push(child);
      }
    }
    ast.children = newChildren;
  }

  return ok(renderAstToMarkdown(ast));
};

type MatchState = {
  viewIndex: number;
  snapIndex: number;
  snapTextOffset: number;
};

export const extractFieldSlotsFromAst = (ast: TemplateAST): string[] => {
  const fieldSlots: string[] = [];
  visit(ast, "fieldSlot", (node: FieldSlot) => {
    fieldSlots.push(node.value);
  });
  return fieldSlots;
};

export const extractFields = (
  schema: EntitySchema,
  view: TemplateAST,
  snapshot: BlockAST,
): Result<FieldsetNested> => {
  const fieldset: FieldsetNested = {};
  let error: ErrorObject | undefined = undefined;

  const simplifiedView = simplifyViewAst(view);

  const literalMismatch = (context?: string) =>
    createError("literal-mismatch", "View and snapshot content do not match", {
      context,
    });

  const matchFieldSlot = (
    viewChild: FieldSlot,
    snapChildren: Nodes[],
    state: MatchState,
    viewChildren: SimplifiedViewNode[],
  ): boolean => {
    const fieldPath = viewChild.path as FieldKey[];
    const fieldDef = getFieldDefNested(schema, fieldPath);

    if (fieldDef === undefined) {
      error = createError(
        "field-not-found",
        `Field '${fieldPath}' was not found in schema`,
      );
      return false;
    }

    let snapText = "";

    if (
      state.snapIndex < snapChildren.length &&
      snapChildren[state.snapIndex]!.type === "text"
    ) {
      const snapNode = snapChildren[state.snapIndex]! as Text;
      const fullSnapText = snapNode.value || "";
      const remainingSnapText = fullSnapText.slice(state.snapTextOffset);

      const nextViewChild =
        state.viewIndex + 1 < viewChildren.length
          ? viewChildren[state.viewIndex + 1]
          : null;

      if (nextViewChild?.type === "text") {
        const nextLiteral = nextViewChild.value || "";
        const endIndex = remainingSnapText.indexOf(nextLiteral);

        if (endIndex === -1) {
          error = literalMismatch(
            `Cannot find next literal "${nextLiteral}" after fieldSlot`,
          );
          return false;
        }

        snapText = remainingSnapText.slice(0, endIndex);
        state.snapTextOffset += endIndex;
      } else {
        snapText = remainingSnapText;
        state.snapIndex++;
        state.snapTextOffset = 0;
      }
    }

    const valueResult = parseFieldValue(snapText, fieldDef);

    if (isErr(valueResult)) {
      error = valueResult.error;
      return false;
    }

    setNestedValue(fieldset, fieldPath, valueResult.data);
    state.viewIndex++;
    return true;
  };

  const matchTextNode = (
    viewChild: Text,
    snapChildren: Nodes[],
    state: MatchState,
    viewChildren: SimplifiedViewNode[],
  ): boolean => {
    if (state.snapIndex >= snapChildren.length) {
      error = literalMismatch(
        "snapIndex >= snapChildren.length in matchTextNode",
      );
      return false;
    }

    const snapChild = snapChildren[state.snapIndex]!;
    if (snapChild.type !== "text") {
      error = literalMismatch(
        `snapChild.type is ${snapChild.type}, expected text`,
      );
      return false;
    }

    let viewText = viewChild.value || "";
    const snapText = (snapChild.value || "").slice(state.snapTextOffset);

    if (!snapText.startsWith(viewText)) {
      const nextViewChild =
        state.viewIndex + 1 < viewChildren.length
          ? viewChildren[state.viewIndex + 1]
          : null;
      const trimmedViewText = viewText.trimEnd();

      if (
        nextViewChild?.type === "fieldSlot" &&
        snapText.startsWith(trimmedViewText)
      ) {
        viewText = trimmedViewText;
      } else {
        error = literalMismatch(
          `snapText "${snapText}" does not start with viewText "${viewText}"`,
        );
        return false;
      }
    }

    state.snapTextOffset += viewText.length;
    state.viewIndex++;

    if (state.snapTextOffset >= (snapChild.value || "").length) {
      state.snapIndex++;
      state.snapTextOffset = 0;
    }
    return true;
  };

  const matchOtherNode = (
    viewChild: SimplifiedViewNode,
    snapChildren: Nodes[],
    state: MatchState,
    matchChildren: (
      viewChildren: SimplifiedViewNode[],
      snapChildren: Nodes[],
    ) => boolean,
  ): boolean => {
    if (state.snapIndex >= snapChildren.length) {
      error = literalMismatch();
      return false;
    }

    const snapChild = snapChildren[state.snapIndex]!;

    if (viewChild.type !== snapChild.type) {
      error = literalMismatch();
      return false;
    }

    if ("children" in viewChild && "children" in snapChild) {
      if (
        !matchChildren(
          viewChild.children as SimplifiedViewNode[],
          snapChild.children as Nodes[],
        )
      ) {
        return false;
      }
    }

    state.viewIndex++;
    state.snapIndex++;
    state.snapTextOffset = 0;
    return true;
  };

  const matchChildren = (
    viewChildren: SimplifiedViewNode[],
    snapChildren: Nodes[],
  ): boolean => {
    const state: MatchState = {
      viewIndex: 0,
      snapIndex: 0,
      snapTextOffset: 0,
    };

    while (state.viewIndex < viewChildren.length) {
      const viewChild = viewChildren[state.viewIndex]!;

      if (viewChild.type === "fieldSlot") {
        if (!matchFieldSlot(viewChild, snapChildren, state, viewChildren))
          return false;
      } else if (viewChild.type === "text") {
        if (!matchTextNode(viewChild, snapChildren, state, viewChildren))
          return false;
      } else {
        if (!matchOtherNode(viewChild, snapChildren, state, matchChildren)) {
          return false;
        }
      }
    }

    if (state.snapIndex < snapChildren.length) {
      error = createError(
        "extra-content",
        "Snapshot has more content than view",
      );
      return false;
    }

    return true;
  };

  matchChildren(simplifiedView.children, snapshot.children);

  if (error) return err(error);

  return ok(fieldset);
};
