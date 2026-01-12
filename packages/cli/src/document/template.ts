import {
  assertDefinedPass,
  type Brand,
  createError,
  err,
  type ErrorObject,
  fail,
  isErr,
  ok,
  type Result,
} from "@binder/utils";
import {
  type EntitySchema,
  type FieldDef,
  type FieldKey,
  type FieldPath,
  type FieldsetNested,
  type FieldValue,
  getDelimiterForRichtextFormat,
  getDelimiterString,
  getFieldDefNested,
  getNestedValue,
  isFieldsetNested,
  type MultiValueDelimiter,
  parseFieldValue,
  type RichtextFormat,
  setNestedValue,
  splitByDelimiter,
} from "@binder/db";
import type { Nodes, Parent, Root, Text } from "mdast";
import { visit } from "unist-util-visit";
import type { Data, Node, Position as UnistPosition } from "unist";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { type TemplateFormat } from "../cli-config-schema.ts";
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
  type SimplifiedViewBlockChild,
  type SimplifiedViewInlineChild,
  simplifyViewAst,
} from "./markdown.ts";
import { isBlockLevelField, renderFieldValue } from "./field-render.ts";
import {
  BLOCK_TEMPLATE_KEY,
  DOCUMENT_TEMPLATE_KEY,
  PHRASE_TEMPLATE_KEY,
  SECTION_TEMPLATE_KEY,
  type TemplateEntity,
  type TemplateKey,
  type Templates,
} from "./template-entity.ts";

// Union of all possible node types in a simplified view (block or inline level)
type SimplifiedViewChild = SimplifiedViewBlockChild | SimplifiedViewInlineChild;

export interface TemplateRoot extends Node {
  type: "root";
  children: (FieldSlot | Text)[];
  data?: Data;
}

export type TemplateAST = Brand<TemplateRoot, "TemplateAST">;

export type TemplateFieldSlotProps = {
  template?: string;
};

export type TemplateFieldSlot = FieldSlot<TemplateFieldSlotProps>;

export const parseTemplate = (content: string): TemplateAST => {
  const processor = unified().use(remarkParse).use(fieldSlot);
  const ast = processor.parse(content);
  return processor.runSync(ast) as TemplateAST;
};

const findTemplateByKey = (
  templates: Templates,
  key: TemplateKey,
): Result<TemplateEntity> => {
  const template = templates.find((t) => t.key === key);
  if (!template)
    return fail("template-not-found", `Template '${key}' not found`);
  return ok(template);
};

const isSoleChildOfParagraph = (
  parent: Parent | undefined,
  index: number | undefined,
): boolean =>
  parent?.type === "paragraph" && parent.children.length === 1 && index === 0;

const isRelation = (fieldDef: FieldDef): boolean =>
  fieldDef.dataType === "relation";

const isMultiValueRelation = (fieldDef: FieldDef): boolean =>
  isRelation(fieldDef) && fieldDef.allowMultiple === true;

const isMultiValueField = (fieldDef: FieldDef): boolean =>
  fieldDef.allowMultiple === true;

const validateNestedPath = (
  schema: EntitySchema,
  path: FieldPath,
): Result<void> => {
  if (path.length > 2)
    return fail(
      "nested-path-too-deep",
      `Nested path '${path.join(".")}' has more than 2 levels. Use '{${path[0]}|template:...}' with a template that includes the nested fields.`,
    );

  if (path.length === 2) {
    const firstFieldDef = schema.fields[path[0]!];
    const secondFieldDef = getFieldDefNested(schema, path);

    if (
      firstFieldDef &&
      isMultiValueRelation(firstFieldDef) &&
      secondFieldDef &&
      isMultiValueField(secondFieldDef)
    )
      return fail(
        "nested-multi-value-not-supported",
        `Cannot use '{${path.join(".")}' because both '${path[0]}' and '${path[1]}' are multi-value fields. Use '{${path[0]}|template:...}' with a template that includes '{${path[1]}}'.`,
      );
  }

  return ok(undefined);
};

const DEFAULT_TEMPLATE_BY_POSITION: Record<SlotPosition, string> = {
  phrase: PHRASE_TEMPLATE_KEY,
  line: PHRASE_TEMPLATE_KEY,
  block: BLOCK_TEMPLATE_KEY,
  section: SECTION_TEMPLATE_KEY,
  document: DOCUMENT_TEMPLATE_KEY,
};

const getItemTemplate = (
  slot: TemplateFieldSlot,
  templates: Templates,
): TemplateEntity => {
  const templateKey = slot.props?.template;
  if (templateKey) {
    const found = templates?.find((t) => t.key === templateKey);
    if (found) return found;
  }
  const defaultKey = DEFAULT_TEMPLATE_BY_POSITION[getSlotPosition(slot)];
  return assertDefinedPass(templates.find((t) => t.key === defaultKey));
};

const DEFAULT_SLOT_POSITION: SlotPosition = "phrase";

const getSlotPosition = (slot: TemplateFieldSlot): SlotPosition =>
  slot.slotPosition ?? DEFAULT_SLOT_POSITION;

const isInlinePosition = (slotPosition: SlotPosition): boolean =>
  slotPosition === "phrase" || slotPosition === "line";

const getDelimiterForSlotPosition = (
  slotPosition: SlotPosition,
  templateFormat: TemplateFormat | undefined,
): MultiValueDelimiter => {
  if (templateFormat) return getDelimiterForRichtextFormat(templateFormat);
  return getDelimiterForRichtextFormat(slotPosition);
};

const FRONTMATTER_TYPES = ["yaml", "toml"];

const getTemplateBlockCount = (templateAst: TemplateAST): number =>
  templateAst.children.filter((n) => !FRONTMATTER_TYPES.includes(n.type))
    .length;

const renderRelationField = (
  schema: EntitySchema,
  templates: Templates,
  value: FieldsetNested[],
  itemTemplate: TemplateEntity,
  slotPosition: SlotPosition,
  renderingTemplates: Set<string>,
): Result<Nodes[]> => {
  if (renderingTemplates.has(itemTemplate.key)) {
    return fail(
      "template-cycle-detected",
      `Circular template reference detected: '${itemTemplate.key}'`,
    );
  }

  const renderedItems: string[] = [];
  const nestedRendering = new Set(renderingTemplates).add(itemTemplate.key);

  for (const entity of value) {
    const result = renderTemplateAstInternal(
      schema,
      templates,
      itemTemplate.templateAst,
      entity,
      nestedRendering,
    );
    if (isErr(result)) return result;
    renderedItems.push(result.data.trim());
  }

  const delimiter = getDelimiterForSlotPosition(
    slotPosition,
    itemTemplate.templateFormat,
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

  // For block position with block-level content, render as separate blocks
  if (!isInlinePosition(slotPosition) && isBlockLevelField(fieldDef)) {
    const delimiter = getDelimiterForRichtextFormat(slotPosition);
    const delimiterStr = getDelimiterString(delimiter);
    const combinedMarkdown = values
      .map((v) => String(v).trim())
      .join(delimiterStr);
    const ast = parseAst(combinedMarkdown);
    return ast.children as Nodes[];
  }

  const delimiter = getDelimiterForRichtextFormat(slotPosition);
  const delimiterStr = getDelimiterString(delimiter);

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

const getFieldRichtextFormat = (
  fieldDef: FieldDef,
): RichtextFormat | undefined => {
  if (fieldDef.dataType === "richtext") return fieldDef.richtextFormat;
  return undefined;
};

const validateFormatPositionCompatibility = (
  format: RichtextFormat | TemplateFormat | undefined,
  slotPosition: SlotPosition,
): Result<void> => {
  if (!format) return ok(undefined);
  if (!isFormatCompatibleWithPosition(format, slotPosition)) {
    return fail(
      "format-position-incompatible",
      `Format '${format}' is not compatible with slot position '${slotPosition}'`,
    );
  }
  return ok(undefined);
};

const renderFieldSlot = (
  schema: EntitySchema,
  templates: Templates,
  slot: TemplateFieldSlot,
  fieldset: FieldsetNested,
  renderingTemplates: Set<string>,
): Result<Nodes[]> => {
  const pathValidation = validateNestedPath(schema, slot.path);
  if (isErr(pathValidation)) return pathValidation;

  const value = getNestedValue(fieldset, slot.path);
  const fieldDef = getFieldDefNested(schema, slot.path);
  if (!fieldDef)
    return fail(
      "field-not-found",
      `Field '${slot.path.join(".")}' was not found in schema`,
    );

  const slotPosition = getSlotPosition(slot);

  // Handle nested path through multi-value relation: {tasks.title}
  // Format check doesn't apply here - we're just extracting values
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

  // Validate field's richtext format compatibility with slot position
  // (only for direct field access, not nested multi-value relations)
  const fieldFormat = getFieldRichtextFormat(fieldDef);
  const formatCheck = validateFormatPositionCompatibility(
    fieldFormat,
    slotPosition,
  );
  if (isErr(formatCheck)) return formatCheck;

  if (isMultiValueRelation(fieldDef) && Array.isArray(value)) {
    const entities = value.filter(isFieldsetNested);
    if (entities.length > 0) {
      const itemTemplate = getItemTemplate(slot, templates);
      // Validate template's templateFormat compatibility with slot position
      const templateFormatCheck = validateFormatPositionCompatibility(
        itemTemplate.templateFormat,
        slotPosition,
      );
      if (isErr(templateFormatCheck)) return templateFormatCheck;
      return renderRelationField(
        schema,
        templates,
        entities,
        itemTemplate,
        slotPosition,
        renderingTemplates,
      );
    }
  }

  if (isRelation(fieldDef) && value && isFieldsetNested(value)) {
    const itemTemplate = getItemTemplate(slot, templates);
    // Validate template's templateFormat compatibility with slot position
    const templateFormatCheck = validateFormatPositionCompatibility(
      itemTemplate.templateFormat,
      slotPosition,
    );
    if (isErr(templateFormatCheck)) return templateFormatCheck;
    return renderRelationField(
      schema,
      templates,
      [value],
      itemTemplate,
      slotPosition,
      renderingTemplates,
    );
  }

  return ok(renderFieldValue(value, fieldDef));
};

function renderTemplateAstInternal(
  schema: EntitySchema,
  templates: Templates,
  view: TemplateAST,
  fieldset: FieldsetNested,
  renderingTemplates: Set<string>,
): Result<string> {
  const ast = structuredClone(view) as Root;
  let renderError: ErrorObject | undefined;

  const blockReplacements = new Map<Parent, Nodes[]>();

  visit(
    ast,
    "fieldSlot",
    (
      node: TemplateFieldSlot,
      index: number | undefined,
      parent: Parent | undefined,
    ) => {
      if (!parent || typeof index !== "number") return;

      const result = renderFieldSlot(
        schema,
        templates,
        node,
        fieldset,
        renderingTemplates,
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

      if (
        (isBlockLevelField(fieldDef) || isRelation(fieldDef)) &&
        isBlockSlot &&
        hasBlockContent
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
}

export const renderTemplateAst = (
  schema: EntitySchema,
  templates: Templates,
  view: TemplateAST,
  fieldset: FieldsetNested,
): Result<string> =>
  renderTemplateAstInternal(schema, templates, view, fieldset, new Set());

export const renderTemplate = (
  schema: EntitySchema,
  templates: Templates,
  templateKey: TemplateKey,
  fieldset: FieldsetNested,
): Result<string> => {
  const templateResult = findTemplateByKey(templates, templateKey);
  if (isErr(templateResult)) return templateResult;

  return renderTemplateAst(
    schema,
    templates,
    templateResult.data.templateAst,
    fieldset,
  );
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

export const extractFieldPathsFromAst = (ast: TemplateAST): FieldPath[] => {
  const fieldPaths: FieldPath[] = [];
  visit(ast, "fieldSlot", (node: FieldSlot) => {
    fieldPaths.push(node.path);
  });
  return fieldPaths;
};

const extractRelationFromText = (
  schema: EntitySchema,
  templates: Templates,
  snapText: string,
  itemTemplate: TemplateEntity,
  slotPosition: SlotPosition,
): Result<FieldValue> => {
  const delimiter = getDelimiterForSlotPosition(
    slotPosition,
    itemTemplate.templateFormat,
  );
  const segments = splitByDelimiter(snapText, delimiter).filter(
    (s) => s.length > 0,
  );

  if (segments.length === 0) return ok([]);

  const entities: FieldsetNested[] = [];
  for (const segment of segments) {
    const segmentAst = parseMarkdown(segment);
    const result = extractFieldsAst(
      schema,
      templates,
      itemTemplate.templateAst,
      segmentAst,
    );
    if (isErr(result)) return result;
    entities.push(result.data);
  }

  return ok(entities);
};

const extractRelationFromBlocks = (
  schema: EntitySchema,
  templates: Templates,
  blocks: Nodes[],
  itemTemplate: TemplateEntity,
  slotPosition: SlotPosition,
): Result<FieldValue> => {
  if (blocks.length === 0) return ok([]);

  // For non-inline positions with block-level templates, we need to group
  // blocks by the template's block count rather than using text-based delimiters
  if (!isInlinePosition(slotPosition) && slotPosition !== "document") {
    const templateBlockCount = getTemplateBlockCount(itemTemplate.templateAst);

    if (templateBlockCount > 0) {
      const entities: FieldsetNested[] = [];
      for (let i = 0; i < blocks.length; i += templateBlockCount) {
        const entityBlocks = blocks.slice(i, i + templateBlockCount);
        const markdown = renderAstToMarkdown({
          type: "root",
          children: entityBlocks as Root["children"],
        });
        const segmentAst = parseMarkdown(markdown);
        const result = extractFieldsAst(
          schema,
          templates,
          itemTemplate.templateAst,
          segmentAst,
        );
        if (isErr(result)) return result;
        entities.push(result.data);
      }
      return ok(entities);
    }
  }

  const markdown = renderAstToMarkdown({
    type: "root",
    children: blocks as Root["children"],
  });

  return extractRelationFromText(
    schema,
    templates,
    markdown,
    itemTemplate,
    slotPosition,
  );
};

export const extractFieldsAst = (
  schema: EntitySchema,
  templates: Templates,
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
    viewChild: TemplateFieldSlot,
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

    if (isMultiValueRelation(fieldDef)) {
      const itemTemplate = getItemTemplate(viewChild, templates);
      const valueResult = extractRelationFromText(
        schema,
        templates,
        snapText,
        itemTemplate,
        slotPosition,
      );
      if (isErr(valueResult)) {
        error = valueResult.error;
        return false;
      }
      setNestedValue(fieldset, fieldPath, valueResult.data);
      state.viewIndex++;
      return true;
    }

    if (isRelation(fieldDef)) {
      if (snapText.trim() === "") {
        setNestedValue(fieldset, fieldPath, null);
        state.viewIndex++;
        return true;
      }
      const itemTemplate = getItemTemplate(viewChild, templates);
      const segmentAst = parseMarkdown(snapText);
      const extractResult = extractFieldsAst(
        schema,
        templates,
        itemTemplate.templateAst,
        segmentAst,
      );
      if (isErr(extractResult)) {
        error = extractResult.error;
        return false;
      }
      setNestedValue(fieldset, fieldPath, extractResult.data);
      state.viewIndex++;
      return true;
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

  const getSoleFieldSlotFromParagraph = (
    node: SimplifiedViewChild | Nodes,
  ): TemplateFieldSlot | undefined => {
    if (node.type !== "paragraph") return undefined;
    if (!("children" in node)) return undefined;
    const children = node.children as (SimplifiedViewInlineChild | Nodes)[];
    if (children.length !== 1) return undefined;
    const child = children[0];
    if (!child || !("type" in child) || child.type !== "fieldSlot")
      return undefined;
    return child as TemplateFieldSlot;
  };

  const matchBlockFieldSlot = (
    slot: TemplateFieldSlot,
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

    if (fieldDef === undefined) {
      error = createError(
        "field-not-found",
        `Field '${fieldPath}' was not found in schema`,
      );
      return false;
    }

    // Collect block nodes until next view element or end
    const blockNodes: Nodes[] = [];
    const startIndex = state.snapIndex;

    // Find where the block content ends
    const nextViewIndex = state.viewIndex + 1;
    const hasMoreViewContent = nextViewIndex < viewChildren.length;

    // For relations in block/section positions, we need to determine how many
    // blocks to consume based on the template
    const isBlockPositionRelation =
      isRelation(fieldDef) &&
      !isInlinePosition(slotPosition) &&
      slotPosition !== "document";

    if (isBlockPositionRelation && hasMoreViewContent) {
      const itemTemplate = getItemTemplate(slot, templates);
      const templateBlockCount = getTemplateBlockCount(
        itemTemplate.templateAst,
      );

      if (templateBlockCount > 0) {
        if (isMultiValueRelation(fieldDef)) {
          // For multi-value, collect complete entity groups until we can't form another
          // complete group (remaining blocks needed for next view content)
          const remainingSnapBlocks = snapChildren.length - state.snapIndex - 1; // -1 for next view paragraph
          const maxEntities = Math.floor(
            remainingSnapBlocks / templateBlockCount,
          );
          const maxBlocks = maxEntities * templateBlockCount;

          while (
            state.snapIndex < snapChildren.length &&
            blockNodes.length < maxBlocks
          ) {
            blockNodes.push(snapChildren[state.snapIndex]!);
            state.snapIndex++;
          }
        } else {
          // For single relation, collect exactly as many blocks as the template expects
          while (
            state.snapIndex < snapChildren.length &&
            blockNodes.length < templateBlockCount
          ) {
            blockNodes.push(snapChildren[state.snapIndex]!);
            state.snapIndex++;
          }
        }
      }
    } else {
      while (state.snapIndex < snapChildren.length) {
        const snapNode = snapChildren[state.snapIndex]!;

        // For empty relation field - if snapshot has no more content or next is matching view node
        if (hasMoreViewContent) {
          const nextView = viewChildren[nextViewIndex]!;
          if (
            nextView.type === snapNode.type &&
            nextView.type !== "paragraph"
          ) {
            break;
          }
        }

        blockNodes.push(snapNode);
        state.snapIndex++;
      }
    }

    // Handle empty content
    if (blockNodes.length === 0 && startIndex === state.snapIndex) {
      if (isMultiValueRelation(fieldDef)) {
        setNestedValue(fieldset, fieldPath, []);
        state.viewIndex++;
        return true;
      }
      setNestedValue(fieldset, fieldPath, null);
      state.viewIndex++;
      return true;
    }

    if (isMultiValueRelation(fieldDef)) {
      const itemTemplate = getItemTemplate(slot, templates);
      const valueResult = extractRelationFromBlocks(
        schema,
        templates,
        blockNodes,
        itemTemplate,
        slotPosition,
      );
      if (isErr(valueResult)) {
        error = valueResult.error;
        return false;
      }
      setNestedValue(fieldset, fieldPath, valueResult.data);
      state.viewIndex++;
      return true;
    }

    if (isRelation(fieldDef)) {
      const itemTemplate = getItemTemplate(slot, templates);
      const markdown = renderAstToMarkdown({
        type: "root",
        children: blockNodes as Root["children"],
      });
      const segmentAst = parseMarkdown(markdown);
      const extractResult = extractFieldsAst(
        schema,
        templates,
        itemTemplate.templateAst,
        segmentAst,
      );
      if (isErr(extractResult)) {
        error = extractResult.error;
        return false;
      }
      setNestedValue(fieldset, fieldPath, extractResult.data);
      state.viewIndex++;
      return true;
    }

    // For other block-level fields, convert to markdown and parse
    const markdown = renderAstToMarkdown({
      type: "root",
      children: blockNodes as Root["children"],
    });
    const valueResult = parseFieldValue(markdown.trim(), fieldDef);
    if (isErr(valueResult)) {
      error = valueResult.error;
      return false;
    }
    setNestedValue(fieldset, fieldPath, valueResult.data);
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
    // Handle paragraph with sole field slot for block-level fields or relations
    const soleSlot = getSoleFieldSlotFromParagraph(viewChild);
    if (soleSlot) {
      const fieldDef = getFieldDefNested(schema, soleSlot.path);
      if (!fieldDef)
        return matchBlockFieldSlot(soleSlot, snapChildren, state, viewChildren);

      const snapChild = snapChildren[state.snapIndex];
      // Trigger block handling when:
      // 1. Field is block-level (richtext/plaintext with multiline format), OR
      // 2. Field is a relation (single or multi-value) in non-inline slot position, OR
      // 3. Snapshot node type differs from paragraph (e.g., list for relations)
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
            viewChild as TemplateFieldSlot,
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

  return ok(fieldset);
};

export const extractFields = (
  schema: EntitySchema,
  templates: Templates,
  templateKey: TemplateKey,
  snapshot: BlockAST,
): Result<FieldsetNested> => {
  const templateResult = findTemplateByKey(templates, templateKey);
  if (isErr(templateResult)) return templateResult;

  return extractFieldsAst(
    schema,
    templates,
    templateResult.data.templateAst,
    snapshot,
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

const getNodePosition = (node: Nodes): UnistPosition | undefined =>
  node.position;

const getBlockText = (node: Nodes | SimplifiedViewBlockChild): string => {
  if ("children" in node && Array.isArray(node.children)) {
    return node.children
      .map((child) => {
        if ("value" in child && typeof child.value === "string")
          return child.value;
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

  if (hasPrecedingContent) {
    const lastTextNode = allSnapTextNodes[allSnapTextNodes.length - 1]!;
    return lastTextNode.position;
  }

  const firstTextNode = allSnapTextNodes[0]!;
  return firstTextNode.position;
};

export const extractFieldMappings = (
  view: TemplateAST,
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

      let endSnapIdx = snapIdx + 1;
      if (nextViewBlock) {
        while (endSnapIdx < snapBlocks.length) {
          if (blocksMatch(nextViewBlock, snapBlocks[endSnapIdx]!)) break;
          endSnapIdx++;
        }
      } else {
        endSnapIdx = snapBlocks.length;
      }

      const startPos = getNodePosition(snapBlocks[snapIdx]!);
      const endPos = getNodePosition(snapBlocks[endSnapIdx - 1]!);
      if (startPos && endPos) {
        mappings.push({
          path: fieldSlot.path,
          position: combinePositions(startPos, endPos),
        });
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
