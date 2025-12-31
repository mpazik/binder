import {
  type ConfigDataType,
  coreIdentityFieldKeys,
  type EntitySchema,
  type EntityType,
  type EntityUid,
  extractUid,
  type FieldDef,
  type FieldKey,
  type FieldsetNested,
  type FieldValue,
  getAllFieldsForType,
  getFieldDef,
  isFieldsetNested,
  type NodeDataType,
} from "@binder/db";
import {
  assertDefined,
  assertIsArray,
  assertNumber,
  assertSmallerThan,
  assertString,
  isEqual,
  jaccardSimilarity,
  levenshteinSimilarity,
} from "@binder/utils";
import {
  type FieldClassification,
  type FieldClassifications,
} from "./field-classifier.ts";
import { matchEntities } from "./entity-matcher.ts";

export type ScorerConfig = {
  schema: EntitySchema;
  classifications: FieldClassifications;
  listLength: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

// Text similarity below this threshold is treated as complete mismatch (0).
// Eliminates noise from strings that share almost nothing.
const TEXT_SIMILARITY_MIN_THRESHOLD = 0.1;

// Quadratic scaling penalizes partial text matches appropriately:
// - High similarity (0.9) → 0.81: small penalty for minor edits
// - Medium similarity (0.5) → 0.25: moderate penalty for significant changes
// - Low similarity (0.3) → 0.09: large penalty, but still preserves ordering
const scaleTextSimilarity = (sim: number): number =>
  sim < TEXT_SIMILARITY_MIN_THRESHOLD ? 0 : sim * sim;

const compareDates = (
  newVal: string,
  oldVal: string,
  maxDays: number,
): number => {
  const newDate = new Date(newVal).getTime();
  const oldDate = new Date(oldVal).getTime();
  if (isNaN(newDate) || isNaN(oldDate)) return 0;

  const diffDays = Math.abs(newDate - oldDate) / DAY_MS;
  return Math.max(0, 1 - diffDays / maxDays);
};

const compareNumbers = (newVal: number, oldVal: number): number => {
  const maxAbs = Math.max(Math.abs(newVal), Math.abs(oldVal));
  if (maxAbs === 0) return 1;
  return Math.max(0, 1 - Math.abs(newVal - oldVal) / maxAbs);
};

const isIdentityField = (key: string): boolean =>
  coreIdentityFieldKeys.includes(key as (typeof coreIdentityFieldKeys)[number]);

const compareNestedFieldsets = (
  config: ScorerConfig,
  newObj: FieldsetNested,
  oldObj: FieldsetNested,
  rangeTypes: EntityType[],
): number => {
  const allowedFields = new Set<string>();
  for (const rangeType of rangeTypes) {
    for (const field of getAllFieldsForType(rangeType, config.schema, false)) {
      allowedFields.add(field);
    }
  }

  let totalSimilarity = 0;
  let fieldCount = 0;

  for (const [key, newValue] of Object.entries(newObj)) {
    if (isIdentityField(key)) continue;
    if (newValue === undefined) continue;
    if (!allowedFields.has(key)) continue;

    const oldValue = oldObj[key];
    if (oldValue === undefined) continue;

    const fieldDef = getFieldDef(config.schema, key as FieldKey);
    if (!fieldDef) continue;

    totalSimilarity += compareFieldValues(
      config,
      fieldDef,
      newValue as FieldValue,
      oldValue as FieldValue,
    );
    fieldCount++;
  }

  return fieldCount === 0 ? 0 : totalSimilarity / fieldCount;
};

const compareSingleRelation = (
  config: ScorerConfig,
  newVal: FieldValue,
  oldVal: FieldValue,
  rangeTypes: EntityType[],
): number => {
  const newUid = extractUid(newVal);
  const oldUid = extractUid(oldVal);

  if (newUid && oldUid) {
    return newUid === oldUid ? 1 : 0;
  }

  if (isFieldsetNested(newVal) && isFieldsetNested(oldVal)) {
    return compareNestedFieldsets(config, newVal, oldVal, rangeTypes);
  }

  return 0;
};

const compareMultiRelation = (
  config: ScorerConfig,
  newVal: FieldValue,
  oldVal: FieldValue,
  rangeTypes: EntityType[],
): number => {
  assertIsArray(newVal, "newVal in compareMultiRelation");
  assertIsArray(oldVal, "oldVal in compareMultiRelation");
  if (newVal.length === 0 && oldVal.length === 0) return 1;
  if (newVal.length === 0 || oldVal.length === 0) return 0;

  const newEntities = newVal.filter(isFieldsetNested);
  const oldEntities = oldVal.filter(isFieldsetNested);

  const hasBothNestedEntities =
    newEntities.length > 0 && oldEntities.length > 0;

  if (hasBothNestedEntities) {
    const matchResult = matchEntities(config, newEntities, oldEntities);

    let totalSimilarity = 0;
    for (const { newIndex, oldIndex } of matchResult.matches) {
      totalSimilarity += compareNestedFieldsets(
        config,
        newEntities[newIndex]!,
        oldEntities[oldIndex]!,
        rangeTypes,
      );
    }

    const maxLength = Math.max(newVal.length, oldVal.length);
    const matchCount = matchResult.matches.length;

    return (totalSimilarity + matchCount) / (2 * maxLength);
  }

  const newUids = newVal.map(extractUid).filter(Boolean) as EntityUid[];
  const oldUids = oldVal.map(extractUid).filter(Boolean) as EntityUid[];

  return jaccardSimilarity(newUids, oldUids);
};

const compareFieldValues = (
  config: ScorerConfig,
  fieldDef: FieldDef,
  newVal: FieldValue,
  oldVal: FieldValue,
): number => {
  if (isEqual(newVal, oldVal)) return 1;

  if (fieldDef.dataType === "relation") {
    const rangeTypes = fieldDef.range ?? [];
    if (fieldDef.allowMultiple) {
      return compareMultiRelation(config, newVal, oldVal, rangeTypes);
    }
    return compareSingleRelation(config, newVal, oldVal, rangeTypes);
  }

  if (fieldDef.allowMultiple) {
    assertIsArray(newVal, "newVal in compareFieldValues");
    assertIsArray(oldVal, "oldVal in compareFieldValues");
    if (newVal.length === 1 && oldVal.length === 1)
      return isEqual(newVal[0], oldVal[0]) ? 1 : 0;
    return jaccardSimilarity(newVal, oldVal);
  }

  // categorical field value needs to be equal
  if (fieldDef.unique || fieldDef.immutable || fieldDef.options !== undefined)
    return 0;

  switch (fieldDef.dataType as NodeDataType | ConfigDataType) {
    case "boolean":
    case "uid":
    case "seqId":
    case "option":
    case "relation":
      return 0;

    case "date":
      return compareDates(assertString(newVal), assertString(oldVal), 365);

    case "datetime":
      return compareDates(assertString(newVal), assertString(oldVal), 30);

    case "integer":
    case "decimal":
      return compareNumbers(assertNumber(newVal), assertNumber(oldVal));

    case "plaintext":
    case "richtext": {
      const sim = levenshteinSimilarity(
        assertString(newVal),
        assertString(oldVal),
      );
      return scaleTextSimilarity(sim);
    }

    default:
      return 0;
  }
};

const computeFieldScore = (
  similarity: number,
  classification: FieldClassification,
): number => {
  const { m, u } = classification;
  const agreementWeight = Math.log2(m / u);
  const disagreementWeight = Math.log2((1 - m) / (1 - u));

  return similarity * agreementWeight + (1 - similarity) * disagreementWeight;
};

export const computeMatchScore = (
  config: ScorerConfig,
  newNode: FieldsetNested,
  oldNode: FieldsetNested,
  newIndex: number,
  oldIndex: number,
): number => {
  let score = 0;

  for (const [key, newValue] of Object.entries(newNode)) {
    if (newValue === undefined) continue;

    const oldValue = oldNode[key];
    if (oldValue === undefined) continue;

    const fieldKey = key as FieldKey;
    const classification = config.classifications.get(fieldKey);
    if (!classification) continue;

    const fieldDef = getFieldDef(config.schema, fieldKey);
    assertDefined(fieldDef, `fieldDef for ${fieldKey}`);

    const similarity = compareFieldValues(config, fieldDef, newValue, oldValue);
    score += computeFieldScore(similarity, classification);
  }

  assertSmallerThan(newIndex, config.listLength, "newIndex");
  assertSmallerThan(oldIndex, config.listLength, "oldIndex");

  const positionClassification: FieldClassification = {
    m: 0.6,
    u: Math.min(1 / config.listLength, 0.5),
  };

  const positionSimilarity =
    newIndex === oldIndex
      ? 1
      : 1 - Math.abs(newIndex - oldIndex) / Math.max(config.listLength - 1, 1);

  score += computeFieldScore(positionSimilarity, positionClassification);

  return score;
};
