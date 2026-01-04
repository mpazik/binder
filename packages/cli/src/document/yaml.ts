import * as YAML from "yaml";
import {
  Document,
  isMap,
  isPair,
  isScalar,
  isSeq,
  type YAMLMap,
  type YAMLSeq,
} from "yaml";
import { isErr, ok, type Result, tryCatch } from "@binder/utils";
import type { FieldsetNested } from "@binder/db";
import { parseYamlDocument } from "./yaml-cst.ts";

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

export const applyInlineFormatting = (node: YAMLMap | YAMLSeq): void => {
  if (isSeq(node)) {
    for (const item of node.items) {
      if (isMap(item)) {
        applyInlineFormatting(item);
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
      if (isMap(value)) {
        if (shouldRenderInline(value)) {
          value.flow = true;
        } else {
          applyInlineFormatting(value);
        }
      } else if (isSeq(value)) {
        applyInlineFormatting(value);
      }
    }
  }
};

const applyEntityFormatting = (entity: YAMLMap): void => {
  for (const pair of entity.items) {
    const value = pair.value;
    if (isMap(value)) {
      applyInlineFormatting(value);
    } else if (isSeq(value)) {
      applyInlineFormatting(value);
    }
  }
};

export const renderYamlEntity = (data: FieldsetNested): string => {
  const doc = new Document(data);
  const root = doc.contents;
  if (isMap(root)) {
    applyEntityFormatting(root);
  }
  return doc.toString({ indent: 2, lineWidth: 0 });
};

export const renderYamlList = (data: FieldsetNested[]): string => {
  const doc = new Document({ items: data });

  const itemsSeq = doc.getIn(["items"], true) as YAMLSeq | undefined;
  if (itemsSeq && isSeq(itemsSeq)) {
    itemsSeq.items.forEach((item, index) => {
      if (isMap(item)) {
        applyEntityFormatting(item);
        if (index > 0) {
          item.spaceBefore = true;
        }
      }
    });
  }

  return doc.toString({ indent: 2, lineWidth: 0 });
};

export const parseYamlEntity = (content: string): Result<FieldsetNested> => {
  const parseResult = tryCatch(() => YAML.parse(content) as FieldsetNested);
  if (isErr(parseResult)) return parseResult;
  return ok(parseResult.data);
};

export const parseYamlList = (content: string): Result<FieldsetNested[]> => {
  const parseResult = tryCatch(
    () => YAML.parse(content) as { items: FieldsetNested[] },
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
