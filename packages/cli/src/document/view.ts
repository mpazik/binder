import {
  createError,
  err,
  type ErrorObject,
  isErr,
  type JsonValue,
  ok,
  type Result,
} from "@binder/utils";
import { coreFields, type FieldsetNested, type NodeSchema } from "@binder/db";
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
type FieldDef = {
  dataType: string;
  allowMultiple?: boolean;
  range?: string[];
};
type TypeDef = {
  fields: string[];
  extends?: string;
};

const getNestedValue = (
  fieldset: FieldsetNested,
  path: string,
): Result<unknown> => {
  const keys = path.split(".");
  let current: Record<string, unknown> = fieldset;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;

    if (i > 0 && (current === null || current === undefined))
      return err(
        createError("field-not-found", `Field path '${path}' not found`),
      );

    if (i > 0 && typeof current !== "object")
      return err(
        createError("field-not-found", `Field path '${path}' not found`),
      );

    if (!(key in current)) return ok(undefined);

    current = current[key] as Record<string, unknown>;
  }

  return ok(current);
};

const formatValue = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    if (value.length === 0) return "";
    return value.join(", ");
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
};

export const renderView = (
  schema: NodeSchema,
  view: ViewAST,
  fieldset: FieldsetNested,
): Result<string> => {
  const ast = JSON.parse(JSON.stringify(view));

  let error: ErrorObject | undefined = undefined;

  visit(
    ast,
    "viewSlot",
    (node: ViewSlot, index: number | undefined, parent: Parent | undefined) => {
      if (error) return;

      const fieldPath = node.value;
      const valueResult = getNestedValue(fieldset, fieldPath);

      if (isErr(valueResult)) {
        error = valueResult.error;
        return;
      }

      const textValue = formatValue(valueResult.data);

      if (parent && typeof index === "number") {
        parent.children[index] = { type: "text", value: textValue };
      }
    },
  );

  if (error) return err(error);

  return ok(renderAstToMarkdown(ast));
};

const getFieldDef = (schema: NodeSchema, path: string): Result<FieldDef> => {
  const keys = path.split(".");
  const firstKey = keys[0]!;

  if (keys.length === 1 && firstKey in coreFields) {
    return ok(coreFields[firstKey as keyof typeof coreFields]);
  }

  let currentField = schema.fields[firstKey as keyof typeof schema.fields];

  if (!currentField)
    return err(
      createError("field-not-found", `Field '${firstKey}' not found in schema`),
    );

  for (let i = 1; i < keys.length; i++) {
    if (currentField.dataType !== "relation")
      return err(
        createError(
          "field-not-found",
          `Field '${keys[i - 1]}' is not a relation`,
        ),
      );

    if (!currentField.range || currentField.range.length === 0)
      return err(
        createError(
          "field-not-found",
          `Field '${keys[i - 1]}' has no range defined`,
        ),
      );

    const rangeType = currentField.range[0]!;
    const typeDef = schema.types[rangeType as keyof typeof schema.types];

    if (!typeDef)
      return err(
        createError(
          "field-not-found",
          `Type '${rangeType}' not found in schema`,
        ),
      );

    const nextFieldKey = keys[i]!;
    const nextFieldDef =
      schema.fields[nextFieldKey as keyof typeof schema.fields];

    if (!nextFieldDef)
      return err(
        createError(
          "field-not-found",
          `Field '${nextFieldKey}' not found in schema`,
        ),
      );

    const getAllFields = (type: TypeDef): string[] => {
      const fields = [...type.fields];
      if (type.extends) {
        const parentType =
          schema.types[type.extends as keyof typeof schema.types];
        if (parentType) {
          fields.push(...getAllFields(parentType));
        }
      }
      return fields;
    };

    const allFields = getAllFields(typeDef);
    if (!allFields.includes(nextFieldKey))
      return err(
        createError(
          "field-not-found",
          `Field '${nextFieldKey}' not in type '${rangeType}'`,
        ),
      );

    currentField = nextFieldDef;
  }

  return ok(currentField);
};

const setNestedValue = (
  fieldset: FieldsetNested,
  path: string,
  value: unknown,
): void => {
  const keys = path.split(".");
  let current: FieldsetNested = fieldset;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]!;
    if (!(key in current)) current[key] = {};
    current = current[key] as FieldsetNested;
  }

  const lastKey = keys[keys.length - 1]!;
  current[lastKey] = value as JsonValue;
};

const parseFieldValue = (
  rawValue: string,
  fieldDef: FieldDef,
): Result<unknown> => {
  const trimmed = rawValue.trim();

  if (fieldDef.allowMultiple) {
    if (trimmed === "") return ok([]);
    const items = trimmed.split(",").map((item) => item.trim());
    return ok(items);
  }

  if (trimmed === "") return ok(null);

  if (fieldDef.dataType === "seqId" || fieldDef.dataType === "integer") {
    const parsed = parseInt(trimmed, 10);
    if (isNaN(parsed))
      return err(
        createError("invalid-field-value", `Invalid integer: ${trimmed}`),
      );
    return ok(parsed);
  }

  if (fieldDef.dataType === "decimal") {
    const parsed = parseFloat(trimmed);
    if (isNaN(parsed))
      return err(
        createError("invalid-field-value", `Invalid decimal: ${trimmed}`),
      );
    return ok(parsed);
  }

  if (fieldDef.dataType === "boolean") {
    if (trimmed === "true") return ok(true);
    if (trimmed === "false") return ok(false);
    return err(
      createError("invalid-field-value", `Invalid boolean: ${trimmed}`),
    );
  }

  return ok(trimmed);
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
    const fieldPath = viewChild.value;
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
