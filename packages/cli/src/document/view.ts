import {
  assertDefinedPass,
  type Brand,
  createError,
  err,
  type ErrorObject,
  fail,
  isErr,
  ok,
  okVoid,
  type Result,
} from "@binder/utils";

import {
  type EntitySchema,
  type FieldDef,
  type FieldKey,
  type FieldPath,
  type Fieldset,
  type FieldsetNested,
  type FieldValue,
  type Filters,
  extractUid,
  getDelimiterString,
  getFieldDefNested,
  getMultiValueDelimiter,
  getNestedValue,
  isFieldsetNested,
  matchesFilters,
  type MultiValueDelimiter,
  parseFieldValue,
  type RichtextFormat,
  richtextFormats,
  splitByDelimiter,
} from "@binder/repo";
import type { Nodes, Parent, Root, Text } from "mdast";
import { visit } from "unist-util-visit";
import type { Data, Node, Position as UnistPosition } from "unist";
import { unified } from "unified";
import remarkParse from "remark-parse";
import type { ViewFormat } from "../cli-config-schema.ts";
import {
  extractFieldsetFromQuery,
  parseFiltersFromString,
} from "../utils/query.ts";
import { interpolatePlain } from "../utils/interpolate-fields.ts";
import {
  type FieldSlot,
  fieldSlot,
  isFormatCompatibleWithPosition,
  type SlotPosition,
} from "./field-slot.ts";
import {
  type BlockAST,
  type FullAST,
  parseAst,
  parseMarkdown,
  renderAstToMarkdown,
  renderSimplifiedAstToMarkdown,
  type SimplifiedViewBlockChild,
  type SimplifiedViewInlineChild,
  simplifyViewAst,
} from "./markdown.ts";
import { isBlockLevelField, renderFieldValue } from "./field-render.ts";
import {
  BLOCK_VIEW_KEY,
  DOCUMENT_VIEW_KEY,
  PHRASE_VIEW_KEY,
  SECTION_VIEW_KEY,
  type ViewKey,
} from "./view.const.ts";
import { type ViewEntity, type Views } from "./view-entity.ts";
import { createFieldAccumulator } from "./field-accumulator.ts";

type SimplifiedViewChild = SimplifiedViewBlockChild | SimplifiedViewInlineChild;

export type ViewRoot = Node & {
  type: "root";
  children: (FieldSlot | Text)[];
  data?: Data;
};

export type ViewAST = Brand<ViewRoot, "ViewAST">;

const renderBlocksToMarkdown = (blocks: Nodes[]): string =>
  renderSimplifiedAstToMarkdown({
    type: "root",
    children: blocks as Root["children"],
  });

const fieldNotFoundError = (path: FieldPath) =>
  createError(
    "field-not-found",
    `Field '${path.join(".")}' was not found in schema`,
  );

export type ViewFieldSlotProps = {
  view?: string;
  where?: string;
};

export type ViewFieldSlot = FieldSlot<ViewFieldSlotProps>;

const getSlotPosition = (slot: ViewFieldSlot): SlotPosition =>
  slot.slotPosition ?? "phrase";

const isInlinePosition = (slotPosition: SlotPosition): boolean =>
  slotPosition === "phrase" || slotPosition === "line";

const parseWhereFilters = (slot: ViewFieldSlot): Filters | undefined => {
  const whereStr = slot.props?.where;
  if (typeof whereStr !== "string") return undefined;
  return parseFiltersFromString(whereStr);
};

const injectWhereFields = (entities: FieldValue, slot: ViewFieldSlot): void => {
  const filters = parseWhereFilters(slot);
  if (!filters) return;
  const whereFieldset = extractFieldsetFromQuery({ filters });
  if (Array.isArray(entities)) {
    for (const entity of entities) {
      if (isFieldsetNested(entity)) Object.assign(entity, whereFieldset);
    }
  } else if (isFieldsetNested(entities)) {
    Object.assign(entities, whereFieldset);
  }
};

const getSoleFieldSlotFromParagraph = (
  node: SimplifiedViewChild | Nodes,
): ViewFieldSlot | undefined => {
  if (node.type !== "paragraph" || !("children" in node)) return undefined;
  const children = node.children as (SimplifiedViewInlineChild | Nodes)[];
  if (children.length !== 1 || children[0]?.type !== "fieldSlot")
    return undefined;
  return children[0] as ViewFieldSlot;
};

export const parseView = (content: string): ViewAST => {
  const processor = unified().use(remarkParse).use(fieldSlot);
  const ast = processor.parse(content);
  return processor.runSync(ast) as ViewAST;
};

const findViewByKey = (views: Views, key: ViewKey): Result<ViewEntity> => {
  const entry = views.find((t) => t.key === key);
  if (!entry) return fail("view-not-found", `View '${key}' not found`);
  return ok(entry);
};

const isRelation = (fieldDef: FieldDef): boolean =>
  fieldDef.dataType === "relation";

const isMultiValueRelation = (fieldDef: FieldDef): boolean =>
  isRelation(fieldDef) && fieldDef.allowMultiple === true;

const isSoleChildOfParagraph = (
  parent: Parent | undefined,
  index: number | undefined,
): boolean =>
  parent?.type === "paragraph" && parent.children.length === 1 && index === 0;

const validateNestedPath = (
  schema: EntitySchema,
  path: FieldPath,
): Result<void> => {
  if (path.length > 2)
    return fail(
      "nested-path-too-deep",
      `Nested path '${path.join(".")}' has more than 2 levels. Use '{${path[0]}|view:...}' with a view that includes the nested fields.`,
    );

  if (path.length === 2) {
    const firstFieldDef = schema.fields[path[0]!];
    const secondFieldDef = getFieldDefNested(schema, path);

    if (
      firstFieldDef &&
      isMultiValueRelation(firstFieldDef) &&
      secondFieldDef &&
      secondFieldDef.allowMultiple === true
    )
      return fail(
        "nested-multi-value-not-supported",
        `Cannot use '{${path.join(".")}' because both '${path[0]}' and '${path[1]}' are multi-value fields. Use '{${path[0]}|view:...}' with a view that includes '{${path[1]}}'.`,
      );
  }

  return okVoid;
};

const DEFAULT_VIEW_BY_POSITION: Record<SlotPosition, string> = {
  phrase: PHRASE_VIEW_KEY,
  line: PHRASE_VIEW_KEY,
  block: BLOCK_VIEW_KEY,
  section: SECTION_VIEW_KEY,
  part: SECTION_VIEW_KEY,
  document: DOCUMENT_VIEW_KEY,
};

const getItemView = (slot: ViewFieldSlot, views: Views): ViewEntity => {
  const viewKey = slot.props?.view;
  if (viewKey) {
    const found = views.find((t) => t.key === viewKey);
    if (found) return found;
  }
  const defaultKey = DEFAULT_VIEW_BY_POSITION[getSlotPosition(slot)];
  return assertDefinedPass(views.find((t) => t.key === defaultKey));
};

const getDelimiterForSlotPosition = (
  _slotPosition: SlotPosition,
  viewFormat: ViewFormat | undefined,
): MultiValueDelimiter => {
  if (viewFormat) return richtextFormats[viewFormat].delimiter;
  return "blankline";
};

const literalMismatch = (context?: string) =>
  createError("literal-mismatch", "View and snapshot content do not match", {
    data: { context },
  });

const FRONTMATTER_TYPES = ["yaml", "toml"];

const isContentBlock = (n: FieldSlot | Text): boolean =>
  !FRONTMATTER_TYPES.includes(n.type);

const getViewBlockCount = (viewAst: ViewAST): number =>
  viewAst.children.filter(isContentBlock).length;

type BlockSignature = { type: string; depth?: number };

const getFirstBlockSignature = (
  viewAst: ViewAST,
): BlockSignature | undefined => {
  const first = viewAst.children.find(isContentBlock);
  if (!first) return undefined;
  return {
    type: first.type,
    depth: "depth" in first ? (first.depth as number) : undefined,
  };
};

const matchesSignature = (node: Nodes, sig: BlockSignature): boolean =>
  node.type === sig.type &&
  (sig.depth === undefined || !("depth" in node) || node.depth === sig.depth);

/**
 * Split a flat array of block nodes into groups, where each group starts at
 * a node matching the given signature (e.g. a heading at a specific depth).
 * This handles entities with variable block counts (e.g. empty fields that
 * produce fewer blocks than the view defines).
 */
const splitBlocksBySignature = (
  blocks: Nodes[],
  sig: BlockSignature,
): Nodes[][] => {
  const groups: Nodes[][] = [];
  let current: Nodes[] = [];

  for (const block of blocks) {
    if (matchesSignature(block, sig) && current.length > 0) {
      groups.push(current);
      current = [];
    }
    current.push(block);
  }
  if (current.length > 0) groups.push(current);
  return groups;
};

const renderRelationField = (
  schema: EntitySchema,
  views: Views,
  value: FieldsetNested[],
  itemView: ViewEntity,
  slotPosition: SlotPosition,
  renderingViews: Set<string>,
): Result<Nodes[]> => {
  if (renderingViews.has(itemView.key)) {
    return fail(
      "view-cycle-detected",
      `Circular view reference detected: '${itemView.key}'`,
    );
  }

  const renderedItems: string[] = [];
  const nestedRendering = new Set(renderingViews).add(itemView.key);

  for (const entity of value) {
    const result = renderViewAstInternal(
      schema,
      views,
      itemView.viewAst,
      entity,
      nestedRendering,
    );
    if (isErr(result)) return result;
    renderedItems.push(result.data.trim());
  }

  const delimiter = getDelimiterForSlotPosition(
    slotPosition,
    itemView.viewFormat,
  );
  const delimiterStr = getDelimiterString(delimiter);
  const combinedMarkdown = renderedItems.join(delimiterStr);

  const ast = parseAst(combinedMarkdown);
  return ok(ast.children as Nodes[]);
};

const renderNestedFieldValues = (
  entities: FieldsetNested[],
  remainingPath: FieldPath,
  fieldDef: FieldDef,
  slotPosition: SlotPosition,
): Nodes[] => {
  const values = entities
    .map((entity) => getNestedValue(entity, remainingPath))
    .filter((v) => v !== null && v !== undefined);

  if (values.length === 0) return [{ type: "text", value: "" }];

  const delimiterStr = getDelimiterString(getMultiValueDelimiter(fieldDef));

  if (!isInlinePosition(slotPosition) && isBlockLevelField(fieldDef)) {
    const combinedMarkdown = values
      .map((v) => String(v).trim())
      .join(delimiterStr);
    const ast = parseAst(combinedMarkdown);
    return ast.children as Nodes[];
  }

  const renderedValues = values.map((v) => renderFieldValue(v, fieldDef));
  if (renderedValues.length === 1) return renderedValues[0]!;

  const result: Nodes[] = [];
  for (const [i, nodes] of renderedValues.entries()) {
    result.push(...nodes);
    if (i < renderedValues.length - 1) {
      const lastNode = result[result.length - 1];
      if (lastNode?.type === "text") {
        (lastNode as Text).value += delimiterStr;
      } else {
        result.push({ type: "text", value: delimiterStr });
      }
    }
  }
  return result;
};

const validateFormatPositionCompatibility = (
  format: RichtextFormat | ViewFormat | undefined,
  slotPosition: SlotPosition,
  allowMultiple = false,
): Result<void> => {
  if (!format) return okVoid;
  if (!isFormatCompatibleWithPosition(format, slotPosition, allowMultiple))
    return fail(
      "format-position-incompatible",
      `Format '${format}' (${allowMultiple ? "multi" : "single"}-value) is not compatible with slot position '${slotPosition}'`,
    );
  return okVoid;
};

const renderFieldSlot = (
  schema: EntitySchema,
  views: Views,
  slot: ViewFieldSlot,
  fieldset: FieldsetNested,
  renderingViews: Set<string>,
): Result<Nodes[]> => {
  const pathValidation = validateNestedPath(schema, slot.path);
  if (isErr(pathValidation)) return pathValidation;

  const value = getNestedValue(fieldset, slot.path);
  const fieldDef = getFieldDefNested(schema, slot.path);
  if (!fieldDef) return err(fieldNotFoundError(slot.path));

  const slotPosition = getSlotPosition(slot);

  // Nested path through multi-value relation (e.g. {tasks.title}) bypasses format checks
  if (slot.path.length > 1) {
    const firstFieldDef = schema.fields[slot.path[0]!];
    if (firstFieldDef && isMultiValueRelation(firstFieldDef)) {
      const relationValue = getNestedValue(fieldset, [slot.path[0]!]);
      if (Array.isArray(relationValue)) {
        const entities = relationValue.filter(isFieldsetNested);
        return ok(
          renderNestedFieldValues(
            entities,
            slot.path.slice(1),
            fieldDef,
            slotPosition,
          ),
        );
      }
    }
  }

  const fieldFormat =
    fieldDef.dataType === "richtext" ? fieldDef.richtextFormat : undefined;
  const isFieldMulti = fieldDef.allowMultiple === true;
  const formatResult = validateFormatPositionCompatibility(
    fieldFormat,
    slotPosition,
    isFieldMulti,
  );
  if (isErr(formatResult)) return formatResult;

  const whereFilters = parseWhereFilters(slot);

  if (isMultiValueRelation(fieldDef) && Array.isArray(value)) {
    const allEntities = value.filter(isFieldsetNested);
    const entities = whereFilters
      ? allEntities.filter((e) => matchesFilters(whereFilters, e as Fieldset))
      : allEntities;
    if (entities.length > 0) {
      const itemView = getItemView(slot, views);
      const viewResult = validateFormatPositionCompatibility(
        itemView.viewFormat,
        slotPosition,
        true,
      );
      if (isErr(viewResult)) return viewResult;
      return renderRelationField(
        schema,
        views,
        entities,
        itemView,
        slotPosition,
        renderingViews,
      );
    }
    if (whereFilters) return ok([]);
    if (allEntities.length === 0)
      return ok([{ type: "text", value: "" } as Nodes]);
  }

  if (isRelation(fieldDef) && value && isFieldsetNested(value)) {
    if (whereFilters && !matchesFilters(whereFilters, value as Fieldset))
      return ok(renderFieldValue(null, fieldDef));
    const itemView = getItemView(slot, views);
    const viewResult = validateFormatPositionCompatibility(
      itemView.viewFormat,
      slotPosition,
      false,
    );
    if (isErr(viewResult)) return viewResult;
    return renderRelationField(
      schema,
      views,
      [value],
      itemView,
      slotPosition,
      renderingViews,
    );
  }

  return ok(renderFieldValue(value, fieldDef));
};

const renderViewAstInternal = (
  schema: EntitySchema,
  views: Views,
  view: ViewAST,
  fieldset: FieldsetNested,
  renderingViews: Set<string>,
): Result<string> => {
  const ast = structuredClone(view) as Root;
  let renderError: ErrorObject | undefined;

  const blockReplacements = new Map<Parent, Nodes[]>();

  visit(
    ast,
    "fieldSlot",
    (
      node: ViewFieldSlot,
      index: number | undefined,
      parent: Parent | undefined,
    ) => {
      if (!parent || typeof index !== "number") return;

      const result = renderFieldSlot(
        schema,
        views,
        node,
        fieldset,
        renderingViews,
      );
      if (isErr(result)) {
        renderError = result.error;
        return;
      }

      const renderedNodes = result.data;
      const fieldDef = getFieldDefNested(schema, node.path);
      if (!fieldDef) return;

      const slotPosition = getSlotPosition(node);
      const isBlockSlot =
        isSoleChildOfParagraph(parent, index) &&
        !isInlinePosition(slotPosition);
      const hasBlockContent =
        renderedNodes.length > 0 &&
        renderedNodes.some(
          (n) => n.type !== "text" || (n as Text).value !== "",
        );
      const isEmptyWhereResult =
        renderedNodes.length === 0 && parseWhereFilters(node) !== undefined;

      if (
        (isBlockLevelField(fieldDef) || isRelation(fieldDef)) &&
        isBlockSlot &&
        (hasBlockContent || isEmptyWhereResult)
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

  if (renderError) return err(renderError);

  if (blockReplacements.size > 0) {
    const applyBlockReplacements = (parent: Parent) => {
      const newChildren: Nodes[] = [];
      for (const child of parent.children) {
        const replacement = blockReplacements.get(child as Parent);
        if (replacement) {
          newChildren.push(...replacement);
        } else {
          if ("children" in child) applyBlockReplacements(child as Parent);
          newChildren.push(child);
        }
      }
      parent.children = newChildren as typeof parent.children;
    };
    applyBlockReplacements(ast);
  }

  // Interpolate field placeholders in link URLs (not parsed as fieldSlot by micromark)
  visit(ast, "link", (node: Nodes & { url?: string }) => {
    if (typeof node.url !== "string" || !node.url.includes("{")) return;
    const result = interpolatePlain(node.url, (placeholder) => {
      const path = placeholder.split(".") as FieldPath;
      const value = getNestedValue(fieldset, path);
      if (value === null || value === undefined) return ok(`{${placeholder}}`);
      if (typeof value === "object") return ok("");
      return ok(String(value));
    });
    if (!isErr(result)) node.url = result.data;
  });

  return ok(renderAstToMarkdown(ast));
};

export const renderViewAst = (
  schema: EntitySchema,
  views: Views,
  view: ViewAST,
  fieldset: FieldsetNested,
): Result<string> =>
  renderViewAstInternal(schema, views, view, fieldset, new Set());

export const renderView = (
  schema: EntitySchema,
  views: Views,
  viewKey: ViewKey,
  fieldset: FieldsetNested,
): Result<string> => {
  const viewResult = findViewByKey(views, viewKey);
  if (isErr(viewResult)) return viewResult;

  return renderViewAst(schema, views, viewResult.data.viewAst, fieldset);
};

export const extractFieldSlotsFromAst = (ast: ViewAST): string[] => {
  const fieldSlots: string[] = [];
  visit(ast, "fieldSlot", (node: FieldSlot) => {
    fieldSlots.push(node.value);
  });
  return fieldSlots;
};

export const extractFieldPathsFromAst = (ast: ViewAST): FieldPath[] => {
  const fieldPaths: FieldPath[] = [];
  visit(ast, "fieldSlot", (node: FieldSlot) => {
    fieldPaths.push(node.path);
  });
  return fieldPaths;
};

const resolveBaseChildren = (
  base: FieldsetNested,
  fieldPath: FieldPath,
  slot?: ViewFieldSlot,
): FieldsetNested[] => {
  const value = getNestedValue(base, fieldPath);
  if (!Array.isArray(value)) return [];
  const children = value.filter(isFieldsetNested);
  if (!slot) return children;
  const filters = parseWhereFilters(slot);
  if (!filters) return children;
  return children.filter((c) => matchesFilters(filters, c as Fieldset));
};

const resolveBaseChild = (
  base: FieldsetNested,
  fieldPath: FieldPath,
): FieldsetNested => {
  const value = getNestedValue(base, fieldPath);
  if (value !== undefined && isFieldsetNested(value)) return value;
  return {};
};

const extractRelationSegments = (
  schema: EntitySchema,
  views: Views,
  segments: string[],
  itemView: ViewEntity,
  baseChildren: FieldsetNested[],
): Result<FieldValue> => {
  if (segments.length === 0) return ok([]);

  const entities: FieldsetNested[] = [];
  for (let i = 0; i < segments.length; i++) {
    const baseChild = baseChildren[i];
    const result = extractFieldsAst(
      schema,
      views,
      itemView.viewAst,
      parseMarkdown(segments[i]!),
      baseChild ?? {},
    );
    if (isErr(result)) return result;

    // The sub-view template doesn't render {uid}, so the accumulator never
    // extracts it. Carry the base entity's uid forward so diffOwnedChildren
    // can match this segment to the existing entity by uid rather than falling
    // back to content similarity (which breaks when oldChildren is empty).
    const baseUid = baseChild !== undefined ? extractUid(baseChild) : undefined;
    const entity =
      baseUid && !extractUid(result.data)
        ? { uid: baseUid, ...result.data }
        : result.data;

    entities.push(entity);
  }

  return ok(entities);
};

const extractRelationFromText = (
  schema: EntitySchema,
  views: Views,
  snapText: string,
  itemView: ViewEntity,
  slotPosition: SlotPosition,
  baseChildren: FieldsetNested[],
): Result<FieldValue> => {
  const delimiter = getDelimiterForSlotPosition(
    slotPosition,
    itemView.viewFormat,
  );
  const segments = splitByDelimiter(snapText, delimiter).filter(
    (s) => s.length > 0,
  );

  return extractRelationSegments(
    schema,
    views,
    segments,
    itemView,
    baseChildren,
  );
};

const extractRelationFromBlocks = (
  schema: EntitySchema,
  views: Views,
  blocks: Nodes[],
  itemView: ViewEntity,
  slotPosition: SlotPosition,
  baseChildren: FieldsetNested[],
): Result<FieldValue> => {
  if (blocks.length === 0) return ok([]);

  // For non-inline positions with block-level views, we need to group
  // blocks by entity boundaries rather than using text-based delimiters
  // Skip for line/phrase format views where multiple items pack into a single block
  const format = itemView.viewFormat;
  const isBlockGroupable =
    !isInlinePosition(slotPosition) &&
    slotPosition !== "document" &&
    format !== "line" &&
    format !== "phrase";

  if (isBlockGroupable) {
    const sig = getFirstBlockSignature(itemView.viewAst);
    const viewBlockCount = getViewBlockCount(itemView.viewAst);

    // Use signature-based splitting for views starting with a heading
    // (structural marker with depth). Fall back to fixed block count for
    // paragraph-based views where signature splitting would over-split.
    const blockGroups =
      sig?.type === "heading" && sig.depth !== undefined
        ? splitBlocksBySignature(blocks, sig)
        : viewBlockCount > 0
          ? Array.from(
              { length: Math.ceil(blocks.length / viewBlockCount) },
              (_, i) =>
                blocks.slice(i * viewBlockCount, (i + 1) * viewBlockCount),
            )
          : null;

    if (blockGroups) {
      const segments = blockGroups.map(renderBlocksToMarkdown);
      return extractRelationSegments(
        schema,
        views,
        segments,
        itemView,
        baseChildren,
      );
    }
  }

  return extractRelationFromText(
    schema,
    views,
    renderBlocksToMarkdown(blocks),
    itemView,
    slotPosition,
    baseChildren,
  );
};

type MatchState = {
  viewIndex: number;
  snapIndex: number;
  snapTextOffset: number;
};

export const extractFieldsAst = (
  schema: EntitySchema,
  views: Views,
  view: ViewAST,
  snapshot: BlockAST,
  base: FieldsetNested,
): Result<FieldsetNested> => {
  const accumulator = createFieldAccumulator(base);
  let error: ErrorObject | undefined;

  const simplifiedView = simplifyViewAst(view);

  const accumulateRelationValue = (
    fieldPath: FieldPath,
    value: FieldValue,
    slot: ViewFieldSlot,
    isMultiValue: boolean,
  ): void => {
    injectWhereFields(value, slot);
    if (isMultiValue && parseWhereFilters(slot)) {
      accumulator.append(fieldPath, value);
    } else {
      accumulator.set(fieldPath, value);
    }
  };

  const matchFieldSlot = (
    viewChild: ViewFieldSlot,
    snapChildren: Nodes[],
    state: MatchState,
    viewChildren: SimplifiedViewInlineChild[],
  ): boolean => {
    const fieldPath = viewChild.path as FieldKey[];
    const slotPosition = getSlotPosition(viewChild);

    const pathValidation = validateNestedPath(schema, fieldPath);
    if (isErr(pathValidation)) {
      error = pathValidation.error;
      return false;
    }

    const fieldDef = getFieldDefNested(schema, fieldPath);
    if (!fieldDef) {
      error = fieldNotFoundError(fieldPath);
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

    if (isMultiValueRelation(fieldDef)) {
      const itemView = getItemView(viewChild, views);
      const valueResult = extractRelationFromText(
        schema,
        views,
        snapText,
        itemView,
        slotPosition,
        resolveBaseChildren(base, fieldPath, viewChild),
      );
      if (isErr(valueResult)) {
        error = valueResult.error;
        return false;
      }
      accumulateRelationValue(fieldPath, valueResult.data, viewChild, true);
      state.viewIndex++;
      return true;
    }

    if (isRelation(fieldDef)) {
      if (snapText.trim() === "") {
        accumulator.set(fieldPath, null);
        state.viewIndex++;
        return true;
      }
      const itemView = getItemView(viewChild, views);
      const segmentAst = parseMarkdown(snapText);
      const extractResult = extractFieldsAst(
        schema,
        views,
        itemView.viewAst,
        segmentAst,
        resolveBaseChild(base, fieldPath),
      );
      if (isErr(extractResult)) {
        error = extractResult.error;
        return false;
      }
      accumulateRelationValue(fieldPath, extractResult.data, viewChild, false);
      state.viewIndex++;
      return true;
    }

    const valueResult = parseFieldValue(snapText, fieldDef);

    if (isErr(valueResult)) {
      error = valueResult.error;
      return false;
    }

    accumulator.set(fieldPath, valueResult.data);
    state.viewIndex++;
    return true;
  };

  const matchTextNode = (
    viewChild: Text,
    snapChildren: Nodes[],
    state: MatchState,
    viewChildren: SimplifiedViewInlineChild[],
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

  const matchBlockFieldSlot = (
    slot: ViewFieldSlot,
    snapChildren: Nodes[],
    state: MatchState,
    viewChildren: Nodes[],
  ): boolean => {
    const fieldPath = slot.path as FieldKey[];
    const slotPosition = getSlotPosition(slot);

    const pathValidation = validateNestedPath(schema, fieldPath);
    if (isErr(pathValidation)) {
      error = pathValidation.error;
      return false;
    }

    const fieldDef = getFieldDefNested(schema, fieldPath);
    if (!fieldDef) {
      error = fieldNotFoundError(fieldPath);
      return false;
    }

    const blockNodes: Nodes[] = [];
    const startIndex = state.snapIndex;

    const nextViewIndex = state.viewIndex + 1;
    const hasMoreViewContent = nextViewIndex < viewChildren.length;

    const isBlockPositionRelation =
      isRelation(fieldDef) &&
      !isInlinePosition(slotPosition) &&
      slotPosition !== "document";

    if (isBlockPositionRelation && hasMoreViewContent) {
      const itemView = getItemView(slot, views);
      const viewBlockCount = getViewBlockCount(itemView.viewAst);

      if (viewBlockCount > 0) {
        if (isMultiValueRelation(fieldDef)) {
          // For section-format views starting with a heading, we can
          // detect entity boundaries by heading depth and collect all blocks
          // until the next view element at the same or shallower depth.
          const sig = getFirstBlockSignature(itemView.viewAst);
          const canDetectBoundary =
            sig?.type === "heading" && sig.depth !== undefined;

          if (canDetectBoundary) {
            while (state.snapIndex < snapChildren.length) {
              const snapNode = snapChildren[state.snapIndex]!;
              // Stop at a heading with depth <= the view.s first heading
              // that is NOT the view.s entity heading depth (i.e. a
              // sibling/parent section boundary like ## Summary)
              if (
                snapNode.type === "heading" &&
                "depth" in snapNode &&
                (snapNode.depth as number) < sig.depth!
              ) {
                break;
              }
              blockNodes.push(snapNode);
              state.snapIndex++;
            }
          } else {
            // Fallback: use fixed block count when we can't detect boundaries
            const remainingSnapBlocks =
              snapChildren.length - state.snapIndex - 1;
            const maxEntities = Math.floor(
              remainingSnapBlocks / viewBlockCount,
            );
            const maxBlocks = maxEntities * viewBlockCount;

            const matchesNextViewNode = (snapNode: Nodes): boolean => {
              if (!hasMoreViewContent) return false;
              const nextView = viewChildren[nextViewIndex]!;
              if (
                nextView.type !== snapNode.type ||
                nextView.type === "paragraph"
              )
                return false;
              if (
                nextView.type === "heading" &&
                "depth" in nextView &&
                "depth" in snapNode
              )
                return nextView.depth === snapNode.depth;
              return true;
            };

            while (
              state.snapIndex < snapChildren.length &&
              blockNodes.length < maxBlocks
            ) {
              if (matchesNextViewNode(snapChildren[state.snapIndex]!)) break;
              blockNodes.push(snapChildren[state.snapIndex]!);
              state.snapIndex++;
            }
          }
        } else {
          while (
            state.snapIndex < snapChildren.length &&
            blockNodes.length < viewBlockCount
          ) {
            blockNodes.push(snapChildren[state.snapIndex]!);
            state.snapIndex++;
          }
        }
      }
    } else {
      while (state.snapIndex < snapChildren.length) {
        const snapNode = snapChildren[state.snapIndex]!;
        if (hasMoreViewContent) {
          const nextView = viewChildren[nextViewIndex]!;
          if (
            nextView.type === snapNode.type &&
            nextView.type !== "paragraph"
          ) {
            // For headings, only break when the snap heading is at or above
            // the next view heading's depth. Deeper headings (e.g. ### inside
            // a sectionDepth:2 field) are valid field content.
            const isDeeperHeading =
              nextView.type === "heading" &&
              "depth" in nextView &&
              "depth" in snapNode &&
              (snapNode as { depth: number }).depth >
                (nextView as { depth: number }).depth;
            if (!isDeeperHeading) break;
          }
        }

        blockNodes.push(snapNode);
        state.snapIndex++;
      }
    }

    if (blockNodes.length === 0 && startIndex === state.snapIndex) {
      if (isMultiValueRelation(fieldDef))
        accumulateRelationValue(fieldPath, [], slot, true);
      else if (fieldDef.allowMultiple === true) accumulator.set(fieldPath, []);
      else accumulator.set(fieldPath, null);
      state.viewIndex++;
      return true;
    }

    if (isMultiValueRelation(fieldDef)) {
      const itemView = getItemView(slot, views);
      const valueResult = extractRelationFromBlocks(
        schema,
        views,
        blockNodes,
        itemView,
        slotPosition,
        resolveBaseChildren(base, fieldPath, slot),
      );
      if (isErr(valueResult)) {
        error = valueResult.error;
        return false;
      }
      accumulateRelationValue(fieldPath, valueResult.data, slot, true);
      state.viewIndex++;
      return true;
    }

    if (isRelation(fieldDef)) {
      const itemView = getItemView(slot, views);
      const segmentAst = parseMarkdown(renderBlocksToMarkdown(blockNodes));
      const extractResult = extractFieldsAst(
        schema,
        views,
        itemView.viewAst,
        segmentAst,
        resolveBaseChild(base, fieldPath),
      );
      if (isErr(extractResult)) {
        error = extractResult.error;
        return false;
      }
      accumulateRelationValue(fieldPath, extractResult.data, slot, false);
      state.viewIndex++;
      return true;
    }

    const valueResult = parseFieldValue(
      renderBlocksToMarkdown(blockNodes).trim(),
      fieldDef,
    );
    if (isErr(valueResult)) {
      error = valueResult.error;
      return false;
    }
    accumulator.set(fieldPath, valueResult.data);
    state.viewIndex++;
    return true;
  };

  const matchOtherNode = (
    viewChild: SimplifiedViewChild,
    snapChildren: Nodes[],
    state: MatchState,
    viewChildren: Nodes[],
    matchChildren: (
      viewChildren: SimplifiedViewChild[],
      snapChildren: Nodes[],
    ) => boolean,
  ): boolean => {
    const soleSlot = getSoleFieldSlotFromParagraph(viewChild);
    if (soleSlot) {
      const fieldDef = getFieldDefNested(schema, soleSlot.path);
      if (!fieldDef)
        return matchBlockFieldSlot(soleSlot, snapChildren, state, viewChildren);

      const snapChild = snapChildren[state.snapIndex];
      const slotPosition = getSlotPosition(soleSlot);
      const needsBlockHandling =
        isBlockLevelField(fieldDef) ||
        (isRelation(fieldDef) && !isInlinePosition(slotPosition)) ||
        !snapChild ||
        snapChild.type !== "paragraph";
      if (needsBlockHandling) {
        return matchBlockFieldSlot(soleSlot, snapChildren, state, viewChildren);
      }
    }

    if (state.snapIndex >= snapChildren.length) {
      error = literalMismatch(
        `snapIndex ${state.snapIndex} >= snapChildren.length ${snapChildren.length}, viewChild.type: ${viewChild.type}`,
      );
      return false;
    }

    const snapChild = snapChildren[state.snapIndex]!;

    if (viewChild.type !== snapChild.type) {
      error = literalMismatch(
        `viewChild.type "${viewChild.type}" !== snapChild.type "${snapChild.type}" at snapIndex ${state.snapIndex}`,
      );
      return false;
    }

    if ("children" in viewChild && "children" in snapChild) {
      if (
        !matchChildren(
          viewChild.children as SimplifiedViewChild[],
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
    viewChildren: SimplifiedViewChild[],
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
        if (
          !matchFieldSlot(
            viewChild as ViewFieldSlot,
            snapChildren,
            state,
            viewChildren as SimplifiedViewInlineChild[],
          )
        )
          return false;
      } else if (viewChild.type === "text") {
        if (
          !matchTextNode(
            viewChild as Text,
            snapChildren,
            state,
            viewChildren as SimplifiedViewInlineChild[],
          )
        )
          return false;
      } else {
        if (
          !matchOtherNode(
            viewChild,
            snapChildren,
            state,
            viewChildren as Nodes[],
            matchChildren,
          )
        ) {
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

  return accumulator.result();
};

export const extractFields = (
  schema: EntitySchema,
  views: Views,
  viewKey: ViewKey,
  snapshot: BlockAST,
  base: FieldsetNested,
): Result<FieldsetNested> => {
  const viewResult = findViewByKey(views, viewKey);
  if (isErr(viewResult)) return viewResult;

  return extractFieldsAst(
    schema,
    views,
    viewResult.data.viewAst,
    snapshot,
    base,
  );
};

export type FieldSlotMapping = {
  path: FieldPath;
  position: UnistPosition;
};

const isSoleFieldSlotParagraph = (
  node: SimplifiedViewBlockChild,
): node is SimplifiedViewBlockChild & { children: [FieldSlot] } =>
  node.type === "paragraph" &&
  Array.isArray(node.children) &&
  node.children.length === 1 &&
  node.children[0]?.type === "fieldSlot";

const combinePositions = (
  start: UnistPosition,
  end: UnistPosition,
): UnistPosition => ({
  start: start.start,
  end: end.end,
});

const getBlockText = (node: Nodes | SimplifiedViewBlockChild): string => {
  if ("children" in node && Array.isArray(node.children)) {
    return node.children
      .map((child) => {
        if ("value" in child) return child.value;
        if ("children" in child) return getBlockText(child as Nodes);
        return "";
      })
      .join("");
  }
  if ("value" in node && typeof node.value === "string") return node.value;
  return "";
};

const blocksMatch = (
  viewBlock: SimplifiedViewBlockChild,
  snapBlock: Nodes,
): boolean => {
  if (viewBlock.type !== snapBlock.type) return false;
  if (viewBlock.type === "paragraph") return false;
  return getBlockText(viewBlock) === getBlockText(snapBlock);
};

const collectTextNodes = (node: Nodes): Nodes[] => {
  if (node.type === "text") return [node];
  if (!("children" in node) || !Array.isArray(node.children)) return [];
  return (node.children as Nodes[]).flatMap(collectTextNodes);
};

const findInlineFieldPosition = (
  snapNode: Nodes,
  viewChildren: SimplifiedViewInlineChild[],
): UnistPosition | undefined => {
  if (!("children" in snapNode) || !Array.isArray(snapNode.children))
    return undefined;

  const fieldSlotIndex = viewChildren.findIndex((c) => c.type === "fieldSlot");
  if (fieldSlotIndex === -1) return undefined;

  const hasPrecedingContent = fieldSlotIndex > 0;
  const allSnapTextNodes = collectTextNodes(snapNode);

  if (allSnapTextNodes.length === 0) return undefined;

  const textNode = hasPrecedingContent
    ? allSnapTextNodes[allSnapTextNodes.length - 1]!
    : allSnapTextNodes[0]!;
  return textNode.position;
};

export const extractFieldMappings = (
  view: ViewAST,
  snapshot: FullAST,
): FieldSlotMapping[] => {
  const mappings: FieldSlotMapping[] = [];
  const simplifiedView = simplifyViewAst(view);
  const viewBlocks = simplifiedView.children;
  const snapBlocks = snapshot.children as Nodes[];

  let viewIdx = 0;
  let snapIdx = 0;

  while (viewIdx < viewBlocks.length && snapIdx < snapBlocks.length) {
    const viewBlock = viewBlocks[viewIdx]!;
    const snapBlock = snapBlocks[snapIdx]!;

    if (isSoleFieldSlotParagraph(viewBlock)) {
      const fieldSlot = viewBlock.children[0];
      const nextViewBlock = viewBlocks[viewIdx + 1];

      let endSnapIdx = snapIdx;
      if (nextViewBlock) {
        while (endSnapIdx < snapBlocks.length) {
          if (blocksMatch(nextViewBlock, snapBlocks[endSnapIdx]!)) break;
          endSnapIdx++;
        }
      } else {
        endSnapIdx = snapBlocks.length;
      }

      if (endSnapIdx > snapIdx) {
        const startPos = snapBlocks[snapIdx]!.position;
        const endPos = snapBlocks[endSnapIdx - 1]!.position;
        if (startPos && endPos) {
          mappings.push({
            path: fieldSlot.path,
            position: combinePositions(startPos, endPos),
          });
        }
      }
      snapIdx = endSnapIdx;
      viewIdx++;
    } else if (viewBlock.type === snapBlock.type) {
      if (
        "children" in viewBlock &&
        Array.isArray(viewBlock.children) &&
        viewBlock.children.some((c) => c.type === "fieldSlot")
      ) {
        const fieldSlot = viewBlock.children.find(
          (c) => c.type === "fieldSlot",
        ) as FieldSlot;
        const position = findInlineFieldPosition(snapBlock, viewBlock.children);
        if (position) {
          mappings.push({ path: fieldSlot.path, position });
        }
      }
      viewIdx++;
      snapIdx++;
    } else {
      snapIdx++;
    }
  }

  return mappings;
};
