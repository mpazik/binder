import {
  createError,
  err,
  type ErrorObject,
  isErr,
  ok,
  type Result,
} from "@binder/utils";
import {
  type FieldKey,
  type FieldsetNested,
  formatFieldValue,
  getFieldDef,
  getNestedValue,
  type NodeSchema,
  parseFieldValue,
  setNestedValue,
} from "@binder/db";
import type { Nodes, Parent, Text } from "mdast";
import { visit } from "unist-util-visit";
import {
  type BlockAST,
  renderAstToMarkdown,
  simplifyViewAst,
  type ViewAST,
} from "./markdown.ts";
import type { ViewSlot } from "./remark-view-slot.ts";

type SimplifiedViewNode = ViewSlot | Text;

export const renderView = (
  _schema: NodeSchema,
  view: ViewAST,
  fieldset: FieldsetNested,
): Result<string> => {
  const ast = structuredClone(view) as Nodes;

  visit(
    ast,
    "viewSlot",
    (node: ViewSlot, index: number | undefined, parent: Parent | undefined) => {
      const fieldPath = node.value.split(".");
      const value = getNestedValue(fieldset, fieldPath);
      const textValue = formatFieldValue(value);

      if (parent && typeof index === "number") {
        parent.children[index] = { type: "text", value: textValue };
      }
    },
  );

  return ok(renderAstToMarkdown(ast));
};

type MatchState = {
  viewIndex: number;
  snapIndex: number;
  snapTextOffset: number;
};

export const extractFields = (
  schema: NodeSchema,
  view: ViewAST,
  snapshot: BlockAST,
): Result<FieldsetNested> => {
  const fieldset: FieldsetNested = {};
  let error: ErrorObject | undefined = undefined;

  const simplifiedView = simplifyViewAst(view);

  const literalMismatch = (context?: string) =>
    createError("literal-mismatch", "View and snapshot content do not match", {
      context,
    });

  const matchViewSlot = (
    viewChild: ViewSlot,
    snapChildren: Nodes[],
    state: MatchState,
    viewChildren: SimplifiedViewNode[],
  ): boolean => {
    const fieldPath = viewChild.value.split(".") as FieldKey[];
    const fieldDefResult = getFieldDef(schema, fieldPath);

    if (isErr(fieldDefResult)) {
      error = fieldDefResult.error;
      return false;
    }

    const fieldDef = fieldDefResult.data;
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
            `Cannot find next literal "${nextLiteral}" after viewSlot`,
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
        nextViewChild?.type === "viewSlot" &&
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

      if (viewChild.type === "viewSlot") {
        if (!matchViewSlot(viewChild, snapChildren, state, viewChildren))
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
