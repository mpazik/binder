import { isEqual, levenshteinSimilarity, ok, type Result } from "@binder/utils";
import {
  type ChangesetsInput,
  coreIdentityFieldKeys,
  type EntityChangesetInput,
  type FieldsetNested,
  type NamespaceEditable,
  type QueryParams,
} from "@binder/db";
import { extractFieldsetFromQuery } from "./query.ts";

const POSITION_MATCH_THRESHOLD = 0.5;
const FALLBACK_MATCH_THRESHOLD = 0.3;

const DIFF_EXCLUDED_FIELDS = new Set([
  ...coreIdentityFieldKeys,
  "blockContent",
  "data",
]);

type NodeMatch = {
  newNode: FieldsetNested;
  oldNode?: FieldsetNested;
  similarity: number;
};

const getContentKey = (node: FieldsetNested): string | undefined => {
  if (typeof node.title === "string") return node.title;
  if (typeof node.textContent === "string") return node.textContent;
  if (typeof node.query === "string") return node.query;
  return undefined;
};

const calculateSimilarity = (
  newNode: FieldsetNested,
  oldNode: FieldsetNested,
): number => {
  if (newNode.type !== oldNode.type) return 0;

  const weights = { type: 0.2, contentKey: 0.5, structure: 0.3 };
  let score = weights.type;

  const newKey = getContentKey(newNode);
  const oldKey = getContentKey(oldNode);

  if (newKey && oldKey) {
    const contentSimilarity = levenshteinSimilarity(newKey, oldKey);
    score += weights.contentKey * contentSimilarity;
  } else if (!newKey && !oldKey) {
    score += weights.contentKey;
  }

  const newBC = newNode.blockContent;
  const oldBC = oldNode.blockContent;

  if (Array.isArray(newBC) && Array.isArray(oldBC)) {
    const minLength = Math.min(newBC.length, oldBC.length);
    const maxLength = Math.max(newBC.length, oldBC.length);
    const structureSimilarity = maxLength === 0 ? 1 : minLength / maxLength;
    score += weights.structure * structureSimilarity;
  } else if (!newBC && !oldBC) {
    score += weights.structure;
  }

  return score;
};

const matchNodes = (
  newNodes: FieldsetNested[],
  oldNodes: FieldsetNested[],
): NodeMatch[] => {
  const matches: NodeMatch[] = [];
  const usedOldIndices = new Set<number>();
  const unmatchedNewIndices = new Set<number>();

  const minLength = Math.min(newNodes.length, oldNodes.length);

  for (let i = 0; i < minLength; i++) {
    const newNode = newNodes[i]!;
    const oldNode = oldNodes[i]!;

    if (newNode.type === oldNode.type) {
      const similarity = calculateSimilarity(newNode, oldNode);
      if (similarity > POSITION_MATCH_THRESHOLD) {
        matches.push({ newNode, oldNode, similarity });
        usedOldIndices.add(i);
        continue;
      }
    }
    unmatchedNewIndices.add(i);
  }

  for (let i = minLength; i < newNodes.length; i++) {
    unmatchedNewIndices.add(i);
  }

  for (const newIdx of unmatchedNewIndices) {
    const newNode = newNodes[newIdx]!;
    let bestMatch: number | null = null;
    let bestScore = 0;

    for (let j = 0; j < oldNodes.length; j++) {
      if (usedOldIndices.has(j)) continue;

      const oldNode = oldNodes[j]!;
      if (newNode.type === oldNode.type) {
        const score = calculateSimilarity(newNode, oldNode);
        if (score > bestScore && score > FALLBACK_MATCH_THRESHOLD) {
          bestScore = score;
          bestMatch = j;
        }
      }
    }

    if (bestMatch !== null) {
      matches.push({
        newNode,
        oldNode: oldNodes[bestMatch],
        similarity: bestScore,
      });
      usedOldIndices.add(bestMatch);
    } else {
      matches.push({ newNode, oldNode: undefined, similarity: 0 });
    }
  }

  return matches;
};

const isFieldsetNested = (value: unknown): value is FieldsetNested =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isQueryParams = (value: unknown): value is QueryParams =>
  typeof value === "object" && value !== null && "filters" in value;

const generateChangeset = <N extends NamespaceEditable>(
  newNode: FieldsetNested,
  oldNode?: FieldsetNested,
  parentNode?: FieldsetNested,
): EntityChangesetInput<N> | null => {
  if (!oldNode) {
    let nodeType = newNode.type;

    if (
      !nodeType &&
      parentNode?.type === "Dataview" &&
      isQueryParams(parentNode.query)
    ) {
      const fieldset = extractFieldsetFromQuery(parentNode.query);
      nodeType = fieldset.type;
    }

    if (typeof nodeType !== "string") return null;

    const fields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(newNode)) {
      if (!DIFF_EXCLUDED_FIELDS.has(key) && key !== "type") {
        fields[key] = value;
      }
    }

    return { type: nodeType, ...fields } as EntityChangesetInput<N>;
  }

  const changes: Record<string, unknown> = {};

  for (const [key, newValue] of Object.entries(newNode)) {
    if (DIFF_EXCLUDED_FIELDS.has(key)) continue;

    const oldValue = oldNode[key];
    if (!isEqual(newValue, oldValue)) {
      if (newValue === null && (oldValue === null || oldValue === undefined)) {
        continue;
      }
      changes[key] = newValue;
    }
  }

  if (Object.keys(changes).length === 0) return null;

  const uid = oldNode.uid;
  if (typeof uid !== "string") return null;

  return { $ref: uid, ...changes } as EntityChangesetInput<N>;
};

type NodeMatchWithParent = NodeMatch & { parentNode?: FieldsetNested };

export const diffNodeTrees = (
  newTree: FieldsetNested,
  oldTree: FieldsetNested,
): Result<ChangesetsInput> => {
  const changesets: ChangesetsInput = [];
  const queue: NodeMatchWithParent[] = [
    { newNode: newTree, oldNode: oldTree, similarity: 1 },
  ];

  while (queue.length > 0) {
    const match = queue.shift()!;
    const { newNode, oldNode, parentNode } = match;

    const changeset = generateChangeset(newNode, oldNode, parentNode);
    if (changeset) {
      changesets.push(changeset);
    }

    const newBC = newNode.blockContent;
    if (Array.isArray(newBC)) {
      const newChildren = newBC.filter(isFieldsetNested);
      const oldBC = oldNode?.blockContent;
      const oldChildren = Array.isArray(oldBC)
        ? oldBC.filter(isFieldsetNested)
        : [];

      const childMatches = matchNodes(newChildren, oldChildren);

      for (const childMatch of childMatches) {
        queue.push({ ...childMatch, parentNode: newNode });
      }
    }

    const newData = newNode.data;
    if (Array.isArray(newData)) {
      let newDataItems = newData.filter(isFieldsetNested);

      if (
        newNode.type === "Dataview" &&
        newDataItems.length > 0 &&
        isQueryParams(newNode.query)
      ) {
        const fieldset = extractFieldsetFromQuery(newNode.query);
        newDataItems = newDataItems.map((item) => ({
          ...fieldset,
          ...item,
        }));
      }

      const oldData = oldNode?.data;
      const oldDataItems = Array.isArray(oldData)
        ? oldData.filter(isFieldsetNested)
        : [];

      const dataMatches = matchNodes(newDataItems, oldDataItems);

      for (const dataMatch of dataMatches) {
        queue.push({ ...dataMatch, parentNode: newNode });
      }
    }
  }

  return ok(changesets);
};

export const diffNodeLists = (
  newNodes: FieldsetNested[],
  oldNodes: FieldsetNested[],
): Result<ChangesetsInput> => {
  const changesets: ChangesetsInput = [];
  const matches = matchNodes(newNodes, oldNodes);

  for (const match of matches) {
    const changeset = generateChangeset(match.newNode, match.oldNode);
    if (changeset) {
      changesets.push(changeset);
    }
  }

  return ok(changesets);
};
