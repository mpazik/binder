// Fellegi-Sunter probabilistic matching model
//
// For each field, we estimate two probabilities:
// - m: P(field agrees | same entity) - match probability
// - u: P(field agrees | different entities) - unrelated match chance
//
// These probabilities determine evidence weights:
// - Agreement weight: log2(m/u) - evidence when fields match
// - Disagreement weight: log2((1-m)/(1-u)) - evidence when fields differ
//
// Validity constraints: 0 < u < m < 1
import type {
  CoreDataType,
  EntitySchema,
  FieldDef,
  FieldKey,
  PlaintextAlphabet,
  RichtextAlphabet,
} from "@binder/db";

export type FieldClassification = {
  m: number;
  u: number;
};

export type FieldClassifications = Map<FieldKey, FieldClassification>;

export type SchemaContext = {
  typeCount: number;
};

const PLAINTEXT_U_VALUES: Record<PlaintextAlphabet, number> = {
  token: 0.001,
  code: 0.0001,
  word: 0.001,
  line: 0.0001,
  paragraph: 0.00001,
};

const RICHTEXT_U_VALUES: Record<RichtextAlphabet, number> = {
  word: 0.001,
  line: 0.0001,
  block: 0.00001,
  section: 0.000001,
  document: 0.0000001,
};

const BASE_U_VALUES: Record<CoreDataType, number> = {
  boolean: 0.5,
  plaintext: 0.0001,
  richtext: 0.00001,
  integer: 0.001,
  decimal: 0.001,
  date: 0.003,
  datetime: 0.0001,
  period: 0.003,
  relation: 0.05,
  uid: 0.0001,
  seqId: 0.0001,
};

const getBaseUnrelatedMatchChance = (
  fieldDef: FieldDef,
  ctx: SchemaContext,
): number => {
  // Type field: uniform distribution over available types
  if (fieldDef.key === "type" && ctx.typeCount > 1) {
    return 1 / ctx.typeCount;
  }

  // Options: uniform distribution over choices (e.g., 4 options → 25% chance)
  if (fieldDef.options && fieldDef.options.length > 1) {
    return 1 / fieldDef.options.length;
  }

  const dataType = fieldDef.dataType as CoreDataType;

  if (dataType === "plaintext" && fieldDef.plaintextAlphabet) {
    return PLAINTEXT_U_VALUES[fieldDef.plaintextAlphabet];
  }

  if (dataType === "richtext" && fieldDef.richtextAlphabet) {
    return RICHTEXT_U_VALUES[fieldDef.richtextAlphabet];
  }

  return BASE_U_VALUES[dataType] ?? 0.01;
};

const estimateUnrelatedMatchChance = (
  fieldDef: FieldDef,
  ctx: SchemaContext,
): number => {
  const base = getBaseUnrelatedMatchChance(fieldDef, ctx);

  // Unique: random match is extremely unlikely
  if (fieldDef.unique) return base * 0.01;

  // Multi-value fields (arrays): random overlap more likely with Jaccard
  if (fieldDef.allowMultiple) return base * 2;

  // Relations: adjust by range narrowness
  if (fieldDef.dataType === "relation" && fieldDef.range) {
    if (fieldDef.range.length === 1) return base * 0.5;
    if (fieldDef.range.length >= 3) return base * 1.5;
  }

  return base;
};

const estimateMatchProbability = (fieldDef: FieldDef): number => {
  if (fieldDef.immutable) return 0.99;
  if (fieldDef.unique) return 0.99;
  if (fieldDef.dataType === "boolean") return 0.7;
  if (fieldDef.dataType === "date" || fieldDef.dataType === "datetime")
    return 0.9;
  if (fieldDef.options && fieldDef.options.length > 0) return 0.7;
  return 0.8;
};

const NEUTRAL_CLASSIFICATION: FieldClassification = { m: 0.5, u: 0.5 };

const classifyFieldDef = (
  fieldDef: FieldDef,
  ctx: SchemaContext,
): FieldClassification => {
  if (fieldDef.options && fieldDef.options.length === 1)
    return NEUTRAL_CLASSIFICATION;

  return {
    m: estimateMatchProbability(fieldDef),
    u: estimateUnrelatedMatchChance(fieldDef, ctx),
  };
};

const EXCLUDED_FIELDS = new Set(["id", "uid"]);

export const classifyFields = (schema: EntitySchema): FieldClassifications => {
  const classifications: FieldClassifications = new Map();
  const ctx: SchemaContext = {
    typeCount: Math.max(Object.keys(schema.types).length, 1),
  };

  for (const [key, fieldDef] of Object.entries(schema.fields)) {
    if (EXCLUDED_FIELDS.has(key)) continue;
    classifications.set(key as FieldKey, classifyFieldDef(fieldDef, ctx));
  }

  return classifications;
};
