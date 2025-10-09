import { ok, omit, type Result } from "@binder/utils";
import type {
  ChangesetsInput,
  EntityChangesetInput,
  FieldsetNested,
} from "@binder/db";
import { extractFieldsetFromQuery } from "./query.ts";

type NodeMatch = {
  fileNode: FieldsetNested;
  kgNode?: FieldsetNested;
  similarity: number;
};

const getContentKey = (node: FieldsetNested): string | undefined => {
  if (typeof node.title === "string") return node.title;
  if (typeof node.textContent === "string") return node.textContent;
  if (typeof node.query === "string") return node.query;
  return undefined;
};

const normalizedLevenshtein = (a: string, b: string): number => {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const matrix: number[][] = Array.from({ length: a.length + 1 }, () =>
    Array(b.length + 1).fill(0),
  );

  for (let i = 0; i <= a.length; i++) matrix[i]![0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0]![j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + cost,
      );
    }
  }

  const distance = matrix[a.length]![b.length]!;
  const maxLength = Math.max(a.length, b.length);
  return 1 - distance / maxLength;
};

const calculateSimilarity = (
  fileNode: FieldsetNested,
  kgNode: FieldsetNested,
): number => {
  if (fileNode.type !== kgNode.type) return 0;

  const weights = { type: 0.2, contentKey: 0.5, structure: 0.3 };
  let score = weights.type;

  const fileKey = getContentKey(fileNode);
  const kgKey = getContentKey(kgNode);

  if (fileKey && kgKey) {
    const contentSimilarity = normalizedLevenshtein(fileKey, kgKey);
    score += weights.contentKey * contentSimilarity;
  } else if (!fileKey && !kgKey) {
    score += weights.contentKey;
  }

  const fileBC = fileNode.blockContent;
  const kgBC = kgNode.blockContent;

  if (Array.isArray(fileBC) && Array.isArray(kgBC)) {
    const minLength = Math.min(fileBC.length, kgBC.length);
    const maxLength = Math.max(fileBC.length, kgBC.length);
    const structureSimilarity = maxLength === 0 ? 1 : minLength / maxLength;
    score += weights.structure * structureSimilarity;
  } else if (!fileBC && !kgBC) {
    score += weights.structure;
  }

  return score;
};

const matchNodes = (
  fileNodes: FieldsetNested[],
  kgNodes: FieldsetNested[],
): NodeMatch[] => {
  const matches: NodeMatch[] = [];
  const usedKgIndices = new Set<number>();
  const unmatchedFileIndices = new Set<number>();

  const minLength = Math.min(fileNodes.length, kgNodes.length);

  for (let i = 0; i < minLength; i++) {
    const fileNode = fileNodes[i]!;
    const kgNode = kgNodes[i]!;

    if (fileNode.type === kgNode.type) {
      const similarity = calculateSimilarity(fileNode, kgNode);
      if (similarity > 0.5) {
        matches.push({ fileNode, kgNode, similarity });
        usedKgIndices.add(i);
        continue;
      }
    }
    unmatchedFileIndices.add(i);
  }

  for (let i = minLength; i < fileNodes.length; i++) {
    unmatchedFileIndices.add(i);
  }

  for (const fileIdx of unmatchedFileIndices) {
    const fileNode = fileNodes[fileIdx]!;
    let bestMatch: number | null = null;
    let bestScore = 0;

    for (let j = 0; j < kgNodes.length; j++) {
      if (usedKgIndices.has(j)) continue;

      const kgNode = kgNodes[j]!;
      if (fileNode.type === kgNode.type) {
        const score = calculateSimilarity(fileNode, kgNode);
        if (score > bestScore && score > 0.3) {
          bestScore = score;
          bestMatch = j;
        }
      }
    }

    if (bestMatch !== null) {
      matches.push({
        fileNode,
        kgNode: kgNodes[bestMatch],
        similarity: bestScore,
      });
      usedKgIndices.add(bestMatch);
    } else {
      matches.push({ fileNode, kgNode: undefined, similarity: 0 });
    }
  }

  return matches;
};

const isFieldsetNested = (value: unknown): value is FieldsetNested => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const generateNodeChangeset = (
  fileNode: FieldsetNested,
  kgNode?: FieldsetNested,
  parentNode?: FieldsetNested,
): EntityChangesetInput<"node"> | null => {
  if (!kgNode) {
    let nodeType = fileNode.type as string | undefined;

    if (!nodeType && parentNode?.type === "Dataview") {
      const fieldset = extractFieldsetFromQuery(parentNode.query as string);
      nodeType = fieldset.type;
    }

    if (!nodeType) {
      return null;
    }

    const fields = omit(fileNode, [
      "type",
      "blockContent",
      "data",
      "uid",
      "id",
      "version",
    ]);

    return {
      type: nodeType,
      ...fields,
    } as EntityChangesetInput<"node">;
  }

  const changes: Record<string, unknown> = {};

  for (const [key, fileValue] of Object.entries(fileNode)) {
    if (
      key === "blockContent" ||
      key === "data" ||
      key === "uid" ||
      key === "id" ||
      key === "version"
    ) {
      continue;
    }

    const kgValue = kgNode[key];
    if (JSON.stringify(fileValue) !== JSON.stringify(kgValue)) {
      if (fileValue === null && (kgValue === null || kgValue === undefined)) {
        continue;
      }
      changes[key] = fileValue;
    }
  }

  if (Object.keys(changes).length === 0) {
    return null;
  }

  return {
    $ref: kgNode.uid as string,
    ...changes,
  } as EntityChangesetInput<"node">;
};

type NodeMatchWithParent = NodeMatch & { parentNode?: FieldsetNested };

export const diffNodeTrees = (
  file: FieldsetNested,
  kg: FieldsetNested,
): Result<ChangesetsInput<"node">> => {
  const changesets: EntityChangesetInput<"node">[] = [];
  const queue: NodeMatchWithParent[] = [
    { fileNode: file, kgNode: kg, similarity: 1 },
  ];

  while (queue.length > 0) {
    const match = queue.shift()!;
    const { fileNode, kgNode, parentNode } = match;

    const changeset = generateNodeChangeset(fileNode, kgNode, parentNode);
    if (changeset) {
      changesets.push(changeset);
    }

    const fileBC = fileNode.blockContent;
    if (Array.isArray(fileBC)) {
      const fileChildren = fileBC.filter(isFieldsetNested);
      const kgBC = kgNode?.blockContent;
      const kgChildren = Array.isArray(kgBC)
        ? kgBC.filter(isFieldsetNested)
        : [];

      const childMatches = matchNodes(fileChildren, kgChildren);

      for (const childMatch of childMatches) {
        queue.push({ ...childMatch, parentNode: fileNode });
      }
    }

    const fileData = fileNode.data;
    if (Array.isArray(fileData)) {
      let fileDataItems = fileData.filter(isFieldsetNested);

      if (fileNode.type === "Dataview" && fileDataItems.length > 0) {
        const fieldset = extractFieldsetFromQuery(fileNode.query as string);
        fileDataItems = fileDataItems.map((item) => ({
          ...fieldset,
          ...item,
        }));
      }

      const kgData = kgNode?.data;
      const kgDataItems = Array.isArray(kgData)
        ? kgData.filter(isFieldsetNested)
        : [];

      const dataMatches = matchNodes(fileDataItems, kgDataItems);

      for (const dataMatch of dataMatches) {
        queue.push({ ...dataMatch, parentNode: fileNode });
      }
    }
  }

  return ok(changesets);
};
