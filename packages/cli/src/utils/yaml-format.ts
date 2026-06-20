import { isMap, isScalar, isSeq } from "yaml";
import type { YAMLMap, YAMLSeq } from "yaml";

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
