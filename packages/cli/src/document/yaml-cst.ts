import {
  type Document,
  isMap,
  isPair,
  isScalar,
  isSeq,
  LineCounter,
  type Pair,
  type ParsedNode,
  parseDocument,
} from "yaml";

export type YamlNode = ParsedNode;

export type YamlPath = Array<ParsedNode | Pair>;

export interface Position {
  line: number;
  character: number;
}

export type YamlContextType =
  | "key"
  | "value"
  | "seq-item"
  | "empty"
  | "unknown";

export interface YamlContext {
  type: YamlContextType;
  node: YamlNode | Pair | null;
  path: YamlPath;
  fieldKey?: string;
  parent: ParsedNode | Pair | null;
}

export type ParsedYaml = {
  doc: Document.Parsed;
  lineCounter: LineCounter;
};

export const parseYamlDocument = (text: string): ParsedYaml => {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, keepSourceTokens: true });
  return { doc, lineCounter };
};

export const positionToOffset = (
  position: Position,
  lineCounter: LineCounter,
): number => {
  let offset = 0;
  for (let i = 0; i < position.line; i++) {
    const nextLineStart = lineCounter.lineStarts[i + 1];
    if (nextLineStart !== undefined) {
      offset = nextLineStart;
    }
  }
  return offset + position.character;
};

const hasRange = (node: unknown): node is ParsedNode => {
  return (
    node !== null &&
    typeof node === "object" &&
    "range" in node &&
    Array.isArray(node.range)
  );
};

const isOffsetInRange = (offset: number, range: [number, number, number]) => {
  return offset >= range[0] && offset <= range[2];
};

export const findYamlContext = (
  root: ParsedNode,
  offset: number,
): YamlContext => {
  let bestContext: YamlContext = {
    type: "unknown",
    node: null,
    path: [],
    parent: null,
  };

  const visit = (
    node: ParsedNode | Pair,
    currentPath: YamlPath,
    contextType?: YamlContextType,
  ) => {
    if (isPair(node)) {
      const pairPath = [...currentPath, node];

      if (hasRange(node.key)) {
        const keyRange = node.key.range;
        if (isOffsetInRange(offset, keyRange)) {
          bestContext = {
            type: "key",
            node: node.key,
            path: pairPath,
            parent: currentPath[currentPath.length - 1] ?? null,
          };
          return;
        }
      }

      if (hasRange(node.value)) {
        const valueRange = node.value.range;
        if (isOffsetInRange(offset, valueRange)) {
          const fieldKey = isScalar(node.key)
            ? String(node.key.value)
            : undefined;
          visit(node.value, pairPath, "value");
          if (bestContext.type === "unknown" || bestContext.type === "value") {
            bestContext.fieldKey = fieldKey;
          }
          return;
        }
      }

      if (node.key && hasRange(node.key)) {
        const keyRange = node.key.range;
        if (offset > keyRange[2]) {
          const fieldKey = isScalar(node.key)
            ? String(node.key.value)
            : undefined;

          bestContext = {
            type: "value",
            node: node.value as YamlNode,
            path: pairPath,
            fieldKey,
            parent: currentPath[currentPath.length - 1] ?? null,
          };
          return;
        }
      }

      return;
    }

    if (!hasRange(node)) return;

    const [start, , end] = node.range;
    if (offset < start || offset > end) return;

    const effectiveType = contextType ?? "unknown";
    bestContext = {
      type: effectiveType,
      node,
      path: [...currentPath, node],
      parent: currentPath[currentPath.length - 1] ?? null,
    };

    const newPath = [...currentPath, node];

    if (isMap(node)) {
      for (const item of node.items) {
        visit(item, newPath);
      }
    } else if (isSeq(node)) {
      for (const item of node.items) {
        if (item) {
          if (hasRange(item)) {
            const itemRange = item.range;
            if (isOffsetInRange(offset, itemRange)) {
              bestContext = {
                type: "seq-item",
                node: item,
                path: [...newPath, item],
                parent: node,
              };
              visit(item, newPath, "seq-item");
            }
          }
        }
      }
    }
  };

  visit(root, []);
  return bestContext;
};

export const getPositionContext = (
  text: string,
  position: Position,
): YamlContext | undefined => {
  const { doc, lineCounter } = parseYamlDocument(text);
  if (doc.contents === null) return undefined;
  const offset = positionToOffset(position, lineCounter);
  return findYamlContext(doc.contents, offset);
};

export const getParentMap = (path: YamlPath): ParsedNode | null => {
  for (let i = path.length - 1; i >= 0; i--) {
    const node = path[i];
    if (!isPair(node) && isMap(node)) return node;
  }
  return null;
};

export const getFieldKeys = (mapNode: ParsedNode | Pair): string[] => {
  if (isPair(mapNode) || !isMap(mapNode)) return [];

  const keys: string[] = [];
  for (const item of mapNode.items) {
    if (isPair(item) && item.key && isScalar(item.key)) {
      keys.push(String(item.key.value));
    }
  }
  return keys;
};

export const getSiblingNodes = (
  node: ParsedNode | Pair,
  path: YamlPath,
): Array<ParsedNode | Pair> => {
  if (path.length < 2) return [];

  const parent = path[path.length - 2];

  if (!isPair(parent) && isMap(parent)) {
    return parent.items.filter((item) => item !== node);
  }

  if (!isPair(parent) && isSeq(parent)) {
    return parent.items.filter((item) => item !== node && item !== null);
  }

  return [];
};
