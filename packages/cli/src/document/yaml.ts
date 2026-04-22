import * as YAML from "yaml";
import {
  Document,
  isMap,
  isPair,
  isScalar,
  isSeq,
  YAMLParseError,
  type YAMLMap,
  type YAMLSeq,
} from "yaml";
import {
  createError,
  type ErrorObject,
  isErr,
  ok,
  type Result,
  tryCatch,
} from "@binder/utils";
import {
  type EntitySchema,
  type FieldsetNested,
  getMultiValueDelimiter,
} from "@binder/repo";
import { parseYamlDocument } from "./yaml-cst.ts";

const getBlockFields = (schema?: EntitySchema): Set<string> | undefined => {
  if (!schema) return undefined;
  const keys = new Set<string>();
  for (const [key, field] of Object.entries(schema.fields)) {
    if (field.dataType === "relation") {
      keys.add(key);
    } else if (
      field.allowMultiple &&
      getMultiValueDelimiter(field) !== "comma"
    ) {
      keys.add(key);
    }
  }
  return keys.size > 0 ? keys : undefined;
};

const MAX_INLINE_ITEMS = 5;
const MAX_INLINE_LENGTH = 80;

const estimateInlineLength = (node: YAMLMap | YAMLSeq): number => {
  if (isSeq(node)) {
    const itemLengths = node.items.map((item) =>
      isScalar(item) ? String(item.value).length : 0,
    );
    return (
      2 +
      itemLengths.reduce((sum, len) => sum + len, 0) +
      (node.items.length - 1) * 2
    );
  }

  const pairLengths = node.items.map((pair) => {
    const keyLen = isScalar(pair.key) ? String(pair.key.value).length : 0;
    const valLen = isScalar(pair.value)
      ? String(pair.value.value).length
      : isSeq(pair.value)
        ? estimateInlineLength(pair.value)
        : 0;
    return keyLen + 2 + valLen;
  });
  return (
    4 +
    pairLengths.reduce((sum, len) => sum + len, 0) +
    (node.items.length - 1) * 2
  );
};

const isShallow = (node: YAMLMap | YAMLSeq): boolean => {
  if (isSeq(node)) {
    return node.items.every((item) => isScalar(item));
  }
  return node.items.every(
    (pair) =>
      isScalar(pair.value) ||
      (isSeq(pair.value) && pair.value.items.every((item) => isScalar(item))),
  );
};

const shouldRenderInline = (node: YAMLMap | YAMLSeq): boolean => {
  if (node.items.length > MAX_INLINE_ITEMS) return false;
  if (!isShallow(node)) return false;
  if (estimateInlineLength(node) > MAX_INLINE_LENGTH) return false;
  return true;
};

export const applyInlineFormatting = (
  node: YAMLMap | YAMLSeq,
  blockFields?: Set<string>,
): void => {
  if (isSeq(node)) {
    for (const item of node.items) {
      if (isMap(item)) {
        applyInlineFormatting(item, blockFields);
      } else if (isSeq(item) && shouldRenderInline(item)) {
        item.flow = true;
      }
    }
    if (shouldRenderInline(node)) {
      node.flow = true;
    }
  } else {
    for (const pair of node.items) {
      const value = pair.value;
      const key = isScalar(pair.key) ? String(pair.key.value) : undefined;
      const forceBlock = key !== undefined && blockFields?.has(key);
      if (isMap(value)) {
        if (shouldRenderInline(value)) {
          value.flow = true;
        } else {
          applyInlineFormatting(value, blockFields);
        }
      } else if (isSeq(value)) {
        applyInlineFormatting(value, blockFields);
        if (forceBlock) {
          value.flow = false;
        }
      }
    }
  }
};

const applyEntityFormatting = (
  entity: YAMLMap,
  blockFields?: Set<string>,
): void => {
  for (const pair of entity.items) {
    const value = pair.value;
    const key = isScalar(pair.key) ? String(pair.key.value) : undefined;
    const forceBlock = key !== undefined && blockFields?.has(key);
    if (isMap(value)) {
      applyInlineFormatting(value, blockFields);
    } else if (isSeq(value)) {
      applyInlineFormatting(value, blockFields);
      if (forceBlock) {
        value.flow = false;
      }
    }
  }
};

export const renderYamlEntity = (
  data: FieldsetNested,
  schema?: EntitySchema,
): string => {
  const doc = new Document(data);
  const root = doc.contents;
  if (isMap(root)) {
    applyEntityFormatting(root, getBlockFields(schema));
  }
  return doc.toString({ indent: 2, lineWidth: 0 });
};

export const renderYamlList = (
  data: FieldsetNested[],
  schema?: EntitySchema,
): string => {
  const doc = new Document({ items: data });
  const blockFields = getBlockFields(schema);

  const itemsSeq = doc.getIn(["items"], true) as YAMLSeq | undefined;
  if (itemsSeq && isSeq(itemsSeq)) {
    itemsSeq.items.forEach((item, index) => {
      if (isMap(item)) {
        applyEntityFormatting(item, blockFields);
        if (index > 0) {
          item.spaceBefore = true;
        }
      }
    });
  }

  return doc.toString({ indent: 2, lineWidth: 0 });
};

const friendlyYamlMessages: Record<string, string | undefined> = {
  MISSING_CHAR_implicit:
    "Found text that isn't a `key: value` pair. " +
    "Add a colon after the field name, or quote the value above if it wraps to the next line.",
  MULTILINE_IMPLICIT_KEY:
    "A value appears to span multiple lines without proper quoting. " +
    "Wrap it in quotes or use a block scalar (|).",
  BLOCK_AS_IMPLICIT_KEY:
    "Unexpected nested value. " +
    "Check for unquoted colons in values or incorrect indentation.",
};

const getFriendlyMessage = (error: YAMLParseError): string => {
  const code = error.code;

  // MISSING_CHAR is used for multiple things (missing quote, missing colon, etc.).
  // Only rewrite the "implicit map keys" variant.
  if (code === "MISSING_CHAR" && /implicit map keys/i.test(error.message)) {
    return friendlyYamlMessages.MISSING_CHAR_implicit!;
  }

  const friendly = code ? friendlyYamlMessages[code] : undefined;
  if (friendly) return friendly;

  // Strip the location suffix that the yaml library appends (we add our own).
  return error.message.replace(/ at line \d+, column \d+:[\s\S]*$/, "");
};

const humanizeYamlError = (error: unknown): ErrorObject => {
  if (error instanceof YAMLParseError) {
    const line = error.linePos?.[0]?.line;
    const location = line ? ` (line ${line})` : "";
    const message = `Could not parse YAML${location}: ${getFriendlyMessage(error)}`;
    return createError("yaml_parse_error", message);
  }
  if (error instanceof Error) {
    return createError(error.name, error.message);
  }
  return createError("unknown", String(error));
};

export const parseYamlEntity = (content: string): Result<FieldsetNested> => {
  const parseResult = tryCatch(
    () => YAML.parse(content) as FieldsetNested,
    humanizeYamlError,
  );
  if (isErr(parseResult)) return parseResult;
  return ok(parseResult.data);
};

export const parseYamlList = (content: string): Result<FieldsetNested[]> => {
  const parseResult = tryCatch(
    () => YAML.parse(content) as { items: FieldsetNested[] },
    humanizeYamlError,
  );
  if (isErr(parseResult)) return parseResult;
  return ok(parseResult.data.items);
};

export const findEntityInYamlList = (
  content: string,
  key: string | undefined,
  uid: string | undefined,
): number => {
  const { doc, lineCounter } = parseYamlDocument(content);
  if (!doc.contents || !isSeq(doc.contents)) return 0;

  for (const item of doc.contents.items) {
    if (!isMap(item)) continue;

    for (const pair of item.items) {
      if (!isPair(pair) || !isScalar(pair.key)) continue;
      if (!isScalar(pair.value)) continue;

      const fieldName = String(pair.key.value);
      const fieldValue = String(pair.value.value);

      const matchesKey = fieldName === "key" && key && fieldValue === key;
      const matchesUid = fieldName === "uid" && uid && fieldValue === uid;

      if (!matchesKey && !matchesUid) continue;

      const range = item.range;
      if (!range) return 0;

      const pos = lineCounter.linePos(range[0]);
      return pos.line - 1;
    }
  }

  return 0;
};
