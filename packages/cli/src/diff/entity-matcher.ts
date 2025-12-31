import type { EntitySchema, FieldKey, FieldsetNested } from "@binder/db";
import { auctionMatch } from "./auction-match.ts";
import { computeMatchScore, type ScorerConfig } from "./similarity-scorer.ts";
import { type FieldClassifications } from "./field-classifier.ts";

export type MatcherConfig = {
  schema: EntitySchema;
  classifications: FieldClassifications;
  excludeFields?: Set<FieldKey>;
};

export type MatchResult = {
  matches: { newIndex: number; oldIndex: number }[];
  toCreate: number[];
  toRemove: number[];
};

const getUid = (entity: FieldsetNested): string | undefined => {
  const uid = entity.uid;
  return typeof uid === "string" ? uid : undefined;
};

export const matchEntities = (
  config: MatcherConfig,
  newEntities: FieldsetNested[],
  oldEntities: FieldsetNested[],
): MatchResult => {
  const matches: { newIndex: number; oldIndex: number }[] = [];
  const toCreate: number[] = [];

  const oldByUid = new Map<string, number>();
  for (let i = 0; i < oldEntities.length; i++) {
    const uid = getUid(oldEntities[i]!);
    if (uid) oldByUid.set(uid, i);
  }

  const matchedOldIndices = new Set<number>();
  const anonNewIndices: number[] = [];

  for (let newIdx = 0; newIdx < newEntities.length; newIdx++) {
    const uid = getUid(newEntities[newIdx]!);
    if (!uid) {
      anonNewIndices.push(newIdx);
      continue;
    }

    const oldIdx = oldByUid.get(uid);
    if (oldIdx !== undefined) {
      matches.push({ newIndex: newIdx, oldIndex: oldIdx });
      matchedOldIndices.add(oldIdx);
    } else {
      toCreate.push(newIdx);
    }
  }

  const unmatchedOldIndices: number[] = [];
  for (let i = 0; i < oldEntities.length; i++) {
    if (!matchedOldIndices.has(i)) unmatchedOldIndices.push(i);
  }

  if (anonNewIndices.length === 0 || unmatchedOldIndices.length === 0) {
    return {
      matches,
      toCreate: [...toCreate, ...anonNewIndices],
      toRemove: unmatchedOldIndices,
    };
  }

  const listLength = Math.max(newEntities.length, oldEntities.length);
  const scorerConfig: ScorerConfig = {
    schema: config.schema,
    classifications: config.classifications,
    listLength,
    excludeFields: config.excludeFields,
  };

  const scores: number[][] = [];
  for (const newIdx of anonNewIndices) {
    const row: number[] = [];
    for (const oldIdx of unmatchedOldIndices) {
      const score = computeMatchScore(
        scorerConfig,
        newEntities[newIdx]!,
        oldEntities[oldIdx]!,
        newIdx,
        oldIdx,
      );
      row.push(score);
    }
    scores.push(row);
  }

  const auctionResult = auctionMatch(scores);

  for (const [bidderIdx, itemIdx] of auctionResult.assignment) {
    matches.push({
      newIndex: anonNewIndices[bidderIdx]!,
      oldIndex: unmatchedOldIndices[itemIdx]!,
    });
  }

  for (const i of auctionResult.unassignedBidders) {
    toCreate.push(anonNewIndices[i]!);
  }

  const toRemove = auctionResult.unassignedItems.map(
    (i) => unmatchedOldIndices[i]!,
  );

  return { matches, toCreate, toRemove };
};
