import {
  assertDefinedPass,
  assertNotEmpty,
  err,
  type ErrorObject,
  fail,
  includes,
  isEqual,
  isErr,
  isTuple,
  objEntries,
  objKeys,
  ok,
  okVoid,
  type Result,
  type ResultAsync,
  throwIfError,
  tryCatch,
  isObjectNonEmpty,
} from "@binder/utils";
import { and, eq, ne, sql } from "drizzle-orm";
import { createUid, isValidUid } from "./utils/uid.ts";
import {
  type ChangesetsInput,
  type ConfigKey,
  coreIdentityFieldKeys,
  type DataTypeNs,
  type EntitiesChangeset,
  type EntityChangesetInput,
  type EntityChangesetRef,
  type EntityId,
  type EntityNsUid,
  type EntityRef,
  type EntitySchema,
  type EntityType,
  type EntityUid,
  type FieldAttrDef,
  type FieldChangeset,
  type FieldDef,
  type FieldKey,
  type Fieldset,
  fieldSystemType,
  fieldTypes,
  type FieldValue,
  getOptionDefsForFieldRef,
  getRelationRef,
  getTypeFieldAttrs,
  getTypeFieldKey,
  incrementEntityId,
  isClearChange,
  isDiffInput,
  isEntityCreate,
  isEntityDelete,
  isEntityUpdate,
  getEntityInputRef,
  type EntityMutationInput,
  isInsertMutation,
  isListMutation,
  isListMutationArray,
  isPatchMutation,
  isRemoveMutation,
  isReservedEntityKey,
  isSeqChange,
  isSetChange,
  type ListMutation,
  type NamespaceEditable,
  type NamespaceSchema,
  type RecordFieldDef,
  type RecordKey,
  normalizeInput,
  normalizeOptionSet,
  normalizeValueChange,
  type OptionDefInput,
  type TypeFieldRef,
  typeSystemType,
  CONFIG_APP_ID_OFFSET,
  type ValueChangeSet,
  computeTextDiff,
  isTextDiffNoop,
  getTextChangeType,
} from "./model";
import type { DbTransaction } from "./db.ts";
import {
  fetchEntity,
  fetchEntityFieldset,
  resolveEntityRefs,
  resolveExistingEntities,
} from "./entity-store.ts";
import { validateDataType } from "./data-type-validators.ts";
import { editableEntityTables } from "./schema.ts";
import { matchesFilters } from "./filter-entities.ts";

const systemGeneratedFields = ["id", "txIds"] as const;

const fieldsToExcludeFromValidation = [
  ...coreIdentityFieldKeys,
  "$ref",
  "txIds",
] as const;

const relationInputFieldsToSkip = ["$ref", "type"] as const;

type ValidationError = {
  field?: string;
  message: string;
};

export type ChangesetValidationError = ValidationError & {
  namespace: NamespaceEditable;
  index: number;
};

const shouldSkipRelationInputField = (
  fieldKey: string,
  value: unknown,
): boolean =>
  includes(relationInputFieldsToSkip, fieldKey) || value === undefined;

const getMandatoryFields = (
  schema: EntitySchema,
  typeKey: EntityType,
  entityValues: Fieldset,
): FieldKey[] => {
  const typeDef = schema.types[typeKey];
  if (!typeDef) return [];

  const mandatoryFields: FieldKey[] = [];
  for (const fieldRef of typeDef.fields) {
    const attrs = getTypeFieldAttrs(fieldRef);
    if (!attrs?.required) continue;
    const fieldKey = getTypeFieldKey(fieldRef) as FieldKey;
    const fieldDef = schema.fields[fieldKey];
    if (fieldDef?.when && !matchesFilters(fieldDef.when, entityValues))
      continue;
    mandatoryFields.push(fieldKey);
  }
  return mandatoryFields;
};

const getFieldAttrs = (
  schema: EntitySchema,
  typeKey: EntityType,
): Map<FieldKey, FieldAttrDef> => {
  const attrsMap = new Map<FieldKey, FieldAttrDef>();
  const typeDef = schema.types[typeKey];
  if (!typeDef) return attrsMap;

  for (const fieldRef of typeDef.fields) {
    const fieldKey = getTypeFieldKey(fieldRef);
    const attrs = getTypeFieldAttrs(fieldRef);
    if (attrs) attrsMap.set(fieldKey, attrs);
  }
  return attrsMap;
};

const validateConditionalMandatoryFields = (
  schema: EntitySchema,
  typeKey: EntityType,
  mergedValues: Fieldset,
  inputKeys: FieldKey[],
): ValidationError[] => {
  const errors: ValidationError[] = [];
  const typeDef = schema.types[typeKey];
  if (!typeDef) return errors;

  for (const fieldRef of typeDef.fields) {
    const attrs = getTypeFieldAttrs(fieldRef);
    if (!attrs?.required) continue;

    const fieldKey = getTypeFieldKey(fieldRef) as FieldKey;
    const fieldDef = schema.fields[fieldKey];
    if (!fieldDef?.when) continue;

    if (!matchesFilters(fieldDef.when, mergedValues)) continue;

    if (mergedValues[fieldKey] != null) continue;
    if (inputKeys.includes(fieldKey)) continue;

    errors.push({
      field: fieldKey,
      message: "mandatory property is missing or null",
    });
  }
  return errors;
};

const validatePatchAttrs = <N extends NamespaceEditable>(
  namespace: N,
  fieldKey: FieldKey,
  fieldDef: FieldDef,
  attrs: Fieldset,
  schema: EntitySchema,
): ValidationError[] => {
  const errors: ValidationError[] = [];
  const allowedAttrs = fieldDef.attributes;

  if (!allowedAttrs || allowedAttrs.length === 0) return errors;

  for (const [attrKey, attrValue] of objEntries(attrs)) {
    if (!allowedAttrs.includes(attrKey as FieldKey)) continue;

    const attrFieldDef = schema.fields[attrKey as FieldKey];
    if (!attrFieldDef) continue;

    if (attrValue === undefined) continue;

    const validationResult = validateDataType(
      namespace,
      attrFieldDef as FieldDef<never>,
      attrValue,
    );
    if (isErr(validationResult)) {
      errors.push({
        field: `${fieldKey}.${attrKey}`,
        message: validationResult.error.message ?? "validation failed",
      });
    }
  }

  return errors;
};

const collectMutationsFromValue = (value: unknown): ListMutation[] | null => {
  if (Array.isArray(value) && value[0] === "seq" && Array.isArray(value[1]))
    return value[1] as ListMutation[];
  if (isListMutationArray(value)) return value;
  if (isListMutation(value)) return [value];
  return null;
};

const validateMutations = <N extends NamespaceEditable>(
  namespace: N,
  fieldKey: FieldKey,
  fieldDef: FieldDef<DataTypeNs[N]>,
  mutations: ListMutation[],
  schema: EntitySchema,
): ValidationError[] => {
  const errors: ValidationError[] = [];
  for (const mutation of mutations) {
    if (isPatchMutation(mutation)) {
      errors.push(
        ...validatePatchAttrs(
          namespace,
          fieldKey,
          fieldDef,
          mutation[2] as Fieldset,
          schema,
        ),
      );
      continue;
    }
    const [kind, mutationValue] = mutation;
    const validationResult = validateDataType(
      namespace,
      { ...fieldDef, allowMultiple: false },
      mutationValue as FieldValue,
    );
    if (isErr(validationResult)) {
      errors.push({
        field: fieldKey,
        message: `Invalid ${kind} value: ${validationResult.error.message}`,
      });
    }
  }
  return errors;
};

const validateFieldDefaultValue = (
  input: EntityMutationInput<"config">,
): ValidationError[] => {
  const defaultValue = input["default"] as FieldValue | undefined;
  if (defaultValue === undefined) return [];

  const dataType = input["dataType"] as string | undefined;
  if (!dataType) return [];

  const inputOptions = input["options"] as OptionDefInput[] | undefined;
  const options = inputOptions ? normalizeOptionSet(inputOptions) : undefined;

  const result = validateDataType(
    "record",
    { dataType, allowMultiple: false, options } as RecordFieldDef,
    defaultValue,
  );

  if (isErr(result)) {
    return [
      {
        field: "default",
        message: `default value does not match dataType '${dataType}': ${result.error.message}`,
      },
    ];
  }

  return [];
};

const validateInverseOfField = (
  input: EntityMutationInput<"config">,
  schema: EntitySchema,
  batchInputs: EntityMutationInput<"config">[],
): ValidationError[] => {
  const inverseOfValue = input["inverseOf"] as string | undefined;
  if (!inverseOfValue) return [];

  const fieldKey = input["key"] as string | undefined;
  const allowMultiple = input["allowMultiple"] as boolean | undefined;

  const inverseFieldDef = schema.fields[inverseOfValue as FieldKey];
  const batchFieldInput = batchInputs.find(
    (i) => i["key"] === inverseOfValue && includes(fieldTypes, i["type"]),
  );

  // Target must exist
  if (!inverseFieldDef && !batchFieldInput) {
    return [
      {
        field: "inverseOf",
        message: `inverseOf references non-existent field "${inverseOfValue}"`,
      },
    ];
  }

  // Target must be a relation field
  const dataType =
    inverseFieldDef?.dataType ?? (batchFieldInput?.["dataType"] as string);
  if (dataType !== "relation") {
    return [
      {
        field: "inverseOf",
        message: `inverseOf must reference a relation field, but "${inverseOfValue}" has dataType "${dataType}"`,
      },
    ];
  }

  // Single-value field cannot reference an allowMultiple target
  const targetAllowMultiple =
    inverseFieldDef?.allowMultiple ??
    (batchFieldInput?.["allowMultiple"] as boolean | undefined);
  if (!allowMultiple && targetAllowMultiple) {
    return [
      {
        field: "inverseOf",
        message: `inverseOf on a single-value field cannot reference an allowMultiple field "${inverseOfValue}". Place inverseOf on the allowMultiple side instead.`,
      },
    ];
  }

  // If target also has inverseOf, it must point back to this field
  const targetInverseOf =
    inverseFieldDef?.inverseOf ??
    (batchFieldInput?.["inverseOf"] as string | undefined);
  if (targetInverseOf && targetInverseOf !== fieldKey) {
    return [
      {
        field: "inverseOf",
        message: `inverseOf target "${inverseOfValue}" has inverseOf="${targetInverseOf}" which does not point back to "${fieldKey}"`,
      },
    ];
  }

  return [];
};

const validateTypeFieldDefaults = (
  input: EntityMutationInput<"config">,
  schema: EntitySchema,
): ValidationError[] => {
  const errors: ValidationError[] = [];

  const fields = input["fields"] as TypeFieldRef[] | undefined;
  if (!fields || !Array.isArray(fields)) return errors;

  for (const fieldRef of fields) {
    const attrs = getTypeFieldAttrs(fieldRef);
    if (!attrs?.default) continue;

    const fieldKey = getTypeFieldKey(fieldRef);
    const fieldDef = schema.fields[fieldKey];
    if (!fieldDef) continue;

    const tempFieldDef = {
      dataType: fieldDef.dataType,
      allowMultiple: false,
      options: getOptionDefsForFieldRef(fieldDef, attrs),
    } as RecordFieldDef;
    const validationResult = validateDataType(
      "record",
      tempFieldDef,
      attrs.default,
    );

    if (isErr(validationResult)) {
      errors.push({
        field: `fields.${fieldKey}.default`,
        message: `default value does not match dataType '${fieldDef.dataType}': ${validationResult.error.message}`,
      });
    }
  }

  return errors;
};

const validateChangesetInput = <N extends NamespaceEditable>(
  namespace: N,
  input: EntityMutationInput<N>,
  schema: EntitySchema,
  typeKey: EntityType,
): ValidationError[] => {
  const errors: ValidationError[] = [];
  const fieldAttrs = getFieldAttrs(schema, typeKey);

  const keyValue = input["key"] as string | undefined;
  if (keyValue !== undefined) {
    if (isReservedEntityKey(keyValue)) {
      errors.push({
        field: "key",
        message: `key "${keyValue}" is reserved and cannot be used`,
      });
    }
    if (isValidUid(keyValue)) {
      errors.push({
        field: "key",
        message: `key "${keyValue}" is ambiguous because it matches the UID format`,
      });
    }
  }

  for (const fieldKey of objKeys(input)) {
    if (includes(fieldsToExcludeFromValidation, fieldKey)) {
      continue;
    }
    const fieldDef = schema.fields[fieldKey] as
      | FieldDef<DataTypeNs[N]>
      | undefined;
    if (!fieldDef) {
      errors.push({
        field: fieldKey,
        message: `field "${fieldKey}" is not defined in schema`,
      });
      continue;
    }
    const value = input[fieldKey];

    if (value == null) continue;

    const attrs = fieldAttrs.get(fieldKey);

    if (isEntityUpdate(input)) {
      if (fieldDef.immutable) {
        errors.push({
          field: fieldKey,
          message: "field is immutable and cannot be updated",
        });
        continue;
      }
    } else {
      if (attrs?.value !== undefined && value !== attrs.value) {
        errors.push({
          field: fieldKey,
          message: `field must have value "${attrs.value}", got: ${value}`,
        });
        continue;
      }
    }
    const effectiveFieldDef = {
      ...fieldDef,
      options: getOptionDefsForFieldRef(fieldDef, attrs),
    } as FieldDef<DataTypeNs[N]>;

    if (isDiffInput(value as FieldValue)) {
      if (getTextChangeType(effectiveFieldDef) !== "diff") {
        errors.push({
          field: fieldKey,
          message: "field does not support diff-encoded changes",
        });
      }
      continue;
    }

    const mutations = collectMutationsFromValue(value);
    if (mutations) {
      errors.push(
        ...validateMutations(
          namespace,
          fieldKey,
          effectiveFieldDef,
          mutations,
          schema,
        ),
      );
      continue;
    }

    if (effectiveFieldDef.unique && effectiveFieldDef.allowMultiple) {
      errors.push({
        field: fieldKey,
        message: "unique constraint cannot be used with allowMultiple",
      });
      continue;
    }

    const validationResult = validateDataType(
      namespace,
      effectiveFieldDef,
      value as FieldValue,
    );

    if (isErr(validationResult)) {
      errors.push({
        field: fieldKey,
        message: validationResult.error.message ?? "validation failed",
      });
    }
  }

  if (isEntityUpdate(input)) return errors;

  // For creations, input contains all entity values needed to evaluate `when` conditions.
  // Updates are partial and skip mandatory validation, so this cast is safe.
  const mandatoryFields = getMandatoryFields(
    schema,
    typeKey,
    input as Fieldset,
  );

  for (const fieldKey of mandatoryFields) {
    const attrs = fieldAttrs.get(fieldKey);
    const hasValueConstraint = attrs?.value !== undefined;
    const hasDefault =
      attrs?.default !== undefined ||
      schema.fields[fieldKey]?.default !== undefined;
    if (
      !hasValueConstraint &&
      !hasDefault &&
      (!(fieldKey in input) || input[fieldKey] == null)
    ) {
      errors.push({
        field: fieldKey,
        message: "mandatory property is missing or null",
      });
    }
  }

  return errors;
};

const validateUniquenessConstraints = async <N extends NamespaceEditable>(
  tx: DbTransaction,
  namespace: N,
  input: EntityMutationInput<N>,
  schema: EntitySchema,
  currentEntityUid?: EntityNsUid[N],
): ResultAsync<ValidationError[]> => {
  const errors: ValidationError[] = [];
  const table = editableEntityTables[namespace];

  for (const [fieldKey, value] of objEntries(input)) {
    if (value == null) continue;
    const fieldDef = schema.fields[fieldKey as FieldKey];
    if (!fieldDef || !fieldDef.unique) continue;
    if (fieldDef.allowMultiple) {
      errors.push({
        field: fieldKey,
        message: "unique constraint cannot be used with allowMultiple",
      });
      continue;
    }

    const existingResult = await tryCatch(
      tx
        .select({ uid: table.uid })
        .from(table)
        .where(
          and(
            fieldKey === "key"
              ? eq(table.key, value as RecordKey | ConfigKey)
              : sql`json_extract(fields, '$.${sql.raw(fieldKey)}') = ${value}`,
            currentEntityUid ? ne(table.uid, currentEntityUid) : undefined,
          ),
        )
        .limit(1)
        .then((rows) => rows),
    );

    if (isErr(existingResult)) return existingResult;

    if (existingResult.data.length > 0) {
      const conflictingUid = existingResult.data[0].uid;
      errors.push({
        field: fieldKey,
        message: `value must be unique, already exists in entity ${conflictingUid}`,
      });
    }
  }

  return ok(errors);
};

const validationError = <R>(
  message: string,
  field?: string,
): Result<R, ValidationError[]> => err([{ field, message }]);

type RefToUidMap = Map<string, EntityUid>;

const toSeqChange = (value: FieldValue): FieldChangeset[FieldKey] => {
  if (isListMutationArray(value)) return ["seq", value];
  if (isListMutation(value)) return ["seq", [value]];
  return value;
};

const fetchOptionalFieldValue = async <N extends NamespaceEditable>(
  tx: DbTransaction,
  namespace: N,
  ref: EntityChangesetRef<N>,
  fieldKey: FieldKey,
  newEntityRefs: Set<string>,
  valueForNewEntity?: EntityChangesetRef<N>,
): ResultAsync<EntityChangesetRef<N> | undefined> => {
  if (newEntityRefs.has(String(ref))) return ok(valueForNewEntity);

  const existingResult = await fetchEntityFieldset(tx, namespace, ref, [
    fieldKey,
  ]);
  if (isErr(existingResult)) return existingResult;

  return ok(existingResult.data[fieldKey] as EntityChangesetRef<N> | undefined);
};

const collectRelationKeys = <N extends NamespaceEditable>(
  normalizedInputs: EntityChangesetInput<N>[],
  schema: NamespaceSchema<N>,
): EntityRef[] => {
  const refs: EntityRef[] = [];

  const addIfKey = (ref: string): void => {
    if (!isValidUid(ref)) refs.push(ref as EntityRef);
  };

  const collectFromValue = (value: FieldValue): void => {
    if (typeof value === "string") {
      addIfKey(value);
    } else if (isTuple(value)) {
      addIfKey(value[0]);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") {
          addIfKey(item);
        } else if (isTuple(item)) {
          addIfKey(item[0]);
        }
      }
    }
  };

  for (const input of normalizedInputs) {
    for (const [fieldKey, value] of objEntries(input)) {
      if (shouldSkipRelationInputField(fieldKey, value)) continue;
      const fieldDef = schema.fields[fieldKey];
      if (fieldDef?.dataType !== "relation") continue;

      const fieldValue = value as FieldValue;
      const fieldMutations = collectMutationsFromValue(fieldValue);
      if (fieldMutations) {
        for (const mutation of fieldMutations) {
          if (mutation[0] !== "patch") collectFromValue(mutation[1]);
        }
      } else {
        collectFromValue(fieldValue);
      }
    }
  }

  return refs;
};

const collectIntraBatchKeyToUid = <N extends NamespaceEditable>(
  normalizedInputs: EntityChangesetInput<N>[],
): RefToUidMap => {
  const keyToUid: RefToUidMap = new Map();

  for (const input of normalizedInputs) {
    if (isEntityUpdate(input) || isEntityDelete(input)) continue; // only creates

    const key = input["key"] as string | undefined;
    if (!key) continue;

    const uid = (input["uid"] as EntityUid) ?? createUid();
    keyToUid.set(key, uid);
    (input as Record<string, unknown>)["uid"] = uid;
  }

  return keyToUid;
};

const buildRefToUidMap = async <N extends NamespaceEditable>(
  tx: DbTransaction,
  normalizedInputs: EntityChangesetInput<N>[],
  schema: NamespaceSchema<N>,
): ResultAsync<RefToUidMap> => {
  const intraBatchMap = collectIntraBatchKeyToUid(normalizedInputs);

  const allRefs = collectRelationKeys(normalizedInputs, schema);
  const refsToResolve = allRefs.filter(
    (ref) => !intraBatchMap.has(String(ref)),
  );

  if (refsToResolve.length === 0) return ok(intraBatchMap);

  const resolvedResult = await resolveEntityRefs(tx, "record", refsToResolve);
  if (isErr(resolvedResult)) return resolvedResult;

  const refToUid: RefToUidMap = new Map(intraBatchMap);
  for (let i = 0; i < refsToResolve.length; i++) {
    const originalRef = String(refsToResolve[i]);
    const resolvedUid = resolvedResult.data[i];
    if (resolvedUid && originalRef !== resolvedUid) {
      refToUid.set(originalRef, resolvedUid);
    }
  }

  return ok(refToUid);
};

const resolveRelationRef = (
  value: FieldValue,
  refToUid: RefToUidMap,
): FieldValue => {
  if (typeof value === "string") {
    return refToUid.get(value) ?? value;
  }
  if (isTuple(value)) {
    const resolvedRef = refToUid.get(value[0]) ?? value[0];
    return [resolvedRef, value[1] as Fieldset];
  }
  return value;
};

const resolveRelationFieldValue = (
  fieldDef: FieldDef | undefined,
  value: FieldValue,
  refToUid: RefToUidMap,
): FieldValue => {
  if (fieldDef?.dataType !== "relation") return value;

  if (Array.isArray(value)) {
    return value.map((item) => resolveRelationRef(item, refToUid));
  }
  return resolveRelationRef(value, refToUid);
};

const resolveRelationMutation = (
  fieldDef: FieldDef | undefined,
  mutation: ListMutation,
  refToUid: RefToUidMap,
): ListMutation => {
  if (mutation[0] === "patch") return mutation;
  const resolvedValue = resolveRelationFieldValue(
    fieldDef,
    mutation[1],
    refToUid,
  );
  return [mutation[0], resolvedValue, mutation[2]] as ListMutation;
};

const resolveRelations = <N extends NamespaceEditable>(
  input: EntityChangesetInput<N>,
  schema: NamespaceSchema<N>,
  refToUid: RefToUidMap,
): EntityChangesetInput<N> => {
  if (isEntityDelete(input)) return input;
  const resolved: EntityChangesetInput<N> = { ...input };
  const resolvedFields = resolved as Record<string, FieldValue>;

  for (const [fieldKey, value] of objEntries(input)) {
    if (shouldSkipRelationInputField(fieldKey, value)) continue;

    const fieldDef = schema.fields[fieldKey];
    if (fieldDef?.dataType !== "relation") continue;

    const fieldValue = value as FieldValue;

    if (isListMutationArray(fieldValue)) {
      resolvedFields[fieldKey] = (fieldValue as ListMutation[]).map(
        (mutation) => resolveRelationMutation(fieldDef, mutation, refToUid),
      ) as FieldValue;
    } else if (isListMutation(fieldValue)) {
      resolvedFields[fieldKey] = resolveRelationMutation(
        fieldDef,
        fieldValue as ListMutation,
        refToUid,
      ) as FieldValue;
    } else {
      resolvedFields[fieldKey] = resolveRelationFieldValue(
        fieldDef,
        fieldValue,
        refToUid,
      );
    }
  }

  return resolved;
};

const mergeFieldInto = <N extends NamespaceEditable>(
  target: EntitiesChangeset<N>,
  ref: EntityChangesetRef<N>,
  fieldKey: FieldKey,
  value: FieldChangeset[FieldKey],
): void => {
  target[ref] = { ...(target[ref] ?? {}), [fieldKey]: value };
};

const extractMutations = (
  change: FieldChangeset[FieldKey],
): ListMutation[] | null => {
  if (isListMutationArray(change)) return change;
  const normalized = normalizeValueChange(change);
  if (isSeqChange(normalized)) return normalized[1];
  return null;
};

const toRelationArray = (value: FieldValue | undefined): FieldValue[] => {
  if (value == null) return [];
  if (Array.isArray(value)) return value as FieldValue[];
  return [value];
};

type RelationDeltas = { adds: FieldValue[]; removes: FieldValue[] };

const deltasFromMutations = (mutations: ListMutation[]): RelationDeltas => {
  const adds: FieldValue[] = [];
  const removes: FieldValue[] = [];
  for (const mutation of mutations) {
    if (isInsertMutation(mutation)) adds.push(mutation[1]);
    else if (isRemoveMutation(mutation)) removes.push(mutation[1]);
  }
  return { adds, removes };
};

/**
 * Normalize any relation-field change into per-item add/remove deltas.
 * Handles explicit seq/mutation-array changes, `set`/`clear` changes, and raw
 * array/value literals (the form `buildChangeset` emits for creates). For set
 * changes on existing entities without an embedded previous value, fetches the
 * stored value so we can diff against it.
 */
const deriveRelationDeltas = async <N extends NamespaceEditable>(
  tx: DbTransaction,
  namespace: N,
  parentRef: EntityChangesetRef<N>,
  fieldKey: FieldKey,
  change: FieldChangeset[FieldKey],
  newEntityRefs: Set<string>,
): ResultAsync<RelationDeltas> => {
  const explicit = extractMutations(change);
  if (explicit) return ok(deltasFromMutations(explicit));

  const normalized = normalizeValueChange(change);
  let newArray: FieldValue[] = [];
  let oldArray: FieldValue[] = [];

  if (isSetChange(normalized)) {
    newArray = toRelationArray(normalized[1]);
    if (normalized.length > 2) {
      oldArray = toRelationArray(normalized[2]);
    } else if (!newEntityRefs.has(String(parentRef))) {
      const currentResult = await fetchOptionalFieldValue(
        tx,
        namespace,
        parentRef,
        fieldKey,
        newEntityRefs,
      );
      if (isErr(currentResult)) return currentResult;
      oldArray = toRelationArray(currentResult.data as FieldValue | undefined);
    }
  } else if (isClearChange(normalized)) {
    oldArray = toRelationArray(normalized[1]);
  }

  const matches = (a: FieldValue, b: FieldValue): boolean => {
    const aRef = getRelationRef(a);
    const bRef = getRelationRef(b);
    if (aRef !== undefined && bRef !== undefined) return aRef === bRef;
    return isEqual(a, b);
  };
  const adds = newArray.filter((v) => !oldArray.some((o) => matches(o, v)));
  const removes = oldArray.filter((v) => !newArray.some((n) => matches(n, v)));
  return ok({ adds, removes });
};

/**
 * Derive add/remove deltas for a 1:M change on the many side. Unlike the
 * self-contained M:M case, the many side is virtual and its "previous"
 * membership lives as back-refs on children's direct field — fetched here.
 */
const deriveOneToManyDeltas = async <N extends NamespaceEditable>(
  tx: DbTransaction,
  namespace: N,
  parentRef: EntityChangesetRef<N>,
  directFieldKey: FieldKey,
  change: FieldChangeset[FieldKey],
  newEntityRefs: Set<string>,
): ResultAsync<RelationDeltas> => {
  const explicit = extractMutations(change);
  if (explicit) return ok(deltasFromMutations(explicit));

  const normalized = normalizeValueChange(change);
  const newArray = isSetChange(normalized)
    ? toRelationArray(normalized[1])
    : [];

  let currentChildren: string[] = [];
  if (!newEntityRefs.has(String(parentRef))) {
    const table = editableEntityTables[namespace];
    const rowsResult = await tryCatch(
      tx
        .select({ uid: table.uid })
        .from(table)
        .where(
          sql`json_extract(${table.fields}, ${"$." + directFieldKey}) = ${parentRef}`,
        )
        .then((rows) => rows),
    );
    if (isErr(rowsResult)) return rowsResult;
    currentChildren = rowsResult.data.map((r) => r.uid as string);
  }

  const refOf = (v: FieldValue): string | undefined => {
    const ref = getRelationRef(v);
    if (ref !== undefined) return ref;
    return typeof v === "string" ? v : undefined;
  };
  const newRefs = newArray
    .map(refOf)
    .filter((r): r is string => typeof r === "string");

  const adds: FieldValue[] = newArray.filter((v) => {
    const ref = refOf(v);
    return ref !== undefined && !currentChildren.includes(ref);
  });
  const removes: FieldValue[] = currentChildren
    .filter((uid) => !newRefs.includes(uid))
    .map((uid) => uid as FieldValue);
  return ok({ adds, removes });
};

const expandOneToManyInverse = async <N extends NamespaceEditable>(
  tx: DbTransaction,
  namespace: N,
  parentRef: EntityChangesetRef<N>,
  directFieldKey: FieldKey,
  deltas: RelationDeltas,
  result: EntitiesChangeset<N>,
  newEntityRefs: Set<string>,
): ResultAsync<void> => {
  for (const added of deltas.adds) {
    const childRef = (getRelationRef(added) ?? added) as EntityChangesetRef<N>;
    const currentValueResult = await fetchOptionalFieldValue(
      tx,
      namespace,
      childRef,
      directFieldKey,
      newEntityRefs,
    );
    if (isErr(currentValueResult)) return currentValueResult;
    const current = currentValueResult.data;
    // Idempotent: skip when child already points at this parent.
    if (current != null && isEqual(current, parentRef)) continue;

    const childChange: ValueChangeSet =
      current != null ? ["set", parentRef, current] : ["set", parentRef];
    mergeFieldInto(result, childRef, directFieldKey, childChange);
  }

  for (const removed of deltas.removes) {
    const childRef = (getRelationRef(removed) ??
      removed) as EntityChangesetRef<N>;
    const currentValueResult = await fetchOptionalFieldValue(
      tx,
      namespace,
      childRef,
      directFieldKey,
      newEntityRefs,
      // For newly-created entities in the batch that reference this parent
      // directly, treat their declared value as the current one.
      parentRef,
    );
    if (isErr(currentValueResult)) return currentValueResult;
    const current = currentValueResult.data;
    // Tolerance: if the child's declaring side isn't pointing at this parent,
    // there's nothing to clear. Skip to avoid an assertion at apply time.
    if (current == null || !isEqual(current, parentRef)) continue;
    mergeFieldInto(result, childRef, directFieldKey, ["set", null, parentRef]);
  }
  return okVoid;
};

const expandOneToOneInverse = async <N extends NamespaceEditable>(
  tx: DbTransaction,
  namespace: N,
  parentRef: EntityChangesetRef<N>,
  fieldKey: FieldKey,
  inverseFieldKey: FieldKey,
  change: FieldChangeset[FieldKey],
  result: EntitiesChangeset<N>,
  newEntityRefs: Set<string>,
): ResultAsync<void> => {
  const normalized = normalizeValueChange(change);
  if (!isSetChange(normalized)) return okVoid;

  const newTargetRef = normalized[1] as EntityChangesetRef<N> | null;
  const oldTargetRef = (normalized.length > 2 ? normalized[2] : undefined) as
    | EntityChangesetRef<N>
    | undefined;

  // If we're setting a new target, update its inverse field to point back
  if (newTargetRef != null) {
    const currentInverseValueResult = await fetchOptionalFieldValue(
      tx,
      namespace,
      newTargetRef,
      inverseFieldKey,
      newEntityRefs,
    );
    if (isErr(currentInverseValueResult)) return currentInverseValueResult;

    const currentInverseValue = currentInverseValueResult.data;
    const targetChange: ValueChangeSet =
      currentInverseValue != null
        ? ["set", parentRef, currentInverseValue]
        : ["set", parentRef];

    mergeFieldInto(result, newTargetRef, inverseFieldKey, targetChange);

    // The target's inverse was pointing to a different entity — clear that
    // entity's declaring field so it doesn't dangle.
    if (currentInverseValue != null && currentInverseValue !== parentRef) {
      const displacedFieldValueResult = await fetchOptionalFieldValue(
        tx,
        namespace,
        currentInverseValue,
        fieldKey,
        newEntityRefs,
        newTargetRef,
      );
      if (isErr(displacedFieldValueResult)) return displacedFieldValueResult;

      if (displacedFieldValueResult.data != null) {
        mergeFieldInto(result, currentInverseValue, fieldKey, [
          "set",
          null,
          displacedFieldValueResult.data,
        ]);
      }
    }
  }

  // If we're clearing/replacing, clear the inverse on the old target
  if (oldTargetRef != null && oldTargetRef !== newTargetRef) {
    const oldTargetInverseValueResult = await fetchOptionalFieldValue(
      tx,
      namespace,
      oldTargetRef,
      inverseFieldKey,
      newEntityRefs,
      parentRef,
    );
    if (isErr(oldTargetInverseValueResult)) return oldTargetInverseValueResult;

    if (oldTargetInverseValueResult.data === parentRef) {
      mergeFieldInto(result, oldTargetRef, inverseFieldKey, [
        "set",
        null,
        oldTargetInverseValueResult.data,
      ]);
    }
  }

  return okVoid;
};

const expandManyToManyInverse = async <N extends NamespaceEditable>(
  tx: DbTransaction,
  namespace: N,
  parentRef: EntityChangesetRef<N>,
  inverseFieldKey: FieldKey,
  deltas: RelationDeltas,
  result: EntitiesChangeset<N>,
  newEntityRefs: Set<string>,
): ResultAsync<void> => {
  const emit = async (
    item: FieldValue,
    kind: "insert" | "remove",
  ): ResultAsync<void> => {
    const targetRef = (getRelationRef(item) ?? item) as EntityChangesetRef<N>;
    const currentValueResult = await fetchOptionalFieldValue(
      tx,
      namespace,
      targetRef,
      inverseFieldKey,
      newEntityRefs,
    );
    if (isErr(currentValueResult)) return currentValueResult;
    const current = toRelationArray(
      currentValueResult.data as FieldValue | undefined,
    );
    const contains = current.some(
      (v) => (getRelationRef(v) ?? v) === parentRef,
    );
    // Idempotent + tolerant: skip no-op cascades so pre-existing broken state
    // doesn't trip assertions, and double-writes don't duplicate.
    if (kind === "insert" && contains) return okVoid;
    if (kind === "remove" && !contains) return okVoid;

    const existingSeq = (result[targetRef] ?? {})[inverseFieldKey];
    const existingMutations = existingSeq
      ? (extractMutations(existingSeq) ?? [])
      : [];
    mergeFieldInto(result, targetRef, inverseFieldKey, [
      "seq",
      [...existingMutations, [kind, parentRef]],
    ]);
    return okVoid;
  };

  for (const added of deltas.adds) {
    const r = await emit(added, "insert");
    if (isErr(r)) return r;
  }
  for (const removed of deltas.removes) {
    const r = await emit(removed, "remove");
    if (isErr(r)) return r;
  }
  return okVoid;
};

const expandInverseRelations = async <N extends NamespaceEditable>(
  tx: DbTransaction,
  namespace: N,
  changesets: EntitiesChangeset<N>,
  schema: NamespaceSchema<N>,
): ResultAsync<EntitiesChangeset<N>> => {
  const newEntityRefs = new Set<string>();
  for (const [ref, changeset] of objEntries(changesets)) {
    if (typeof changeset.type === "string") {
      newEntityRefs.add(ref);
    }
  }

  const result = {} as EntitiesChangeset<N>;

  for (const [parentRef, changeset] of objEntries(changesets)) {
    const filteredChangeset: FieldChangeset = {};

    for (const [fieldKey, change] of objEntries(changeset)) {
      const fieldDef = schema.fields[fieldKey];
      if (!fieldDef?.inverseOf) {
        filteredChangeset[fieldKey] = change;
        continue;
      }

      const inverseFieldKey = fieldDef.inverseOf as FieldKey;
      const inverseFieldDef = schema.fields[inverseFieldKey];
      const sourceIsMultiple = !!fieldDef.allowMultiple;
      const targetIsMultiple = !!inverseFieldDef?.allowMultiple;

      if (sourceIsMultiple && !targetIsMultiple) {
        // 1:M — strip declaring side (it is virtual; the single side on each
        // child holds the truth). Emit per-child direct-field updates.
        const deltasResult = await deriveOneToManyDeltas(
          tx,
          namespace,
          parentRef,
          inverseFieldKey,
          change,
          newEntityRefs,
        );
        if (isErr(deltasResult)) return deltasResult;
        const expandResult = await expandOneToManyInverse(
          tx,
          namespace,
          parentRef,
          inverseFieldKey,
          deltasResult.data,
          result,
          newEntityRefs,
        );
        if (isErr(expandResult)) return expandResult;
      } else if (!sourceIsMultiple && !targetIsMultiple) {
        // 1:1 — keep declaring side, also emit set on target
        filteredChangeset[fieldKey] = change;
        const expandResult = await expandOneToOneInverse(
          tx,
          namespace,
          parentRef,
          fieldKey,
          inverseFieldKey,
          change,
          result,
          newEntityRefs,
        );
        if (isErr(expandResult)) return expandResult;
      } else if (sourceIsMultiple && targetIsMultiple) {
        // M:M — keep declaring side, emit per-target insert/remove on inverse.
        filteredChangeset[fieldKey] = change;
        const deltasResult = await deriveRelationDeltas(
          tx,
          namespace,
          parentRef,
          fieldKey,
          change,
          newEntityRefs,
        );
        if (isErr(deltasResult)) return deltasResult;
        const expandResult = await expandManyToManyInverse(
          tx,
          namespace,
          parentRef,
          inverseFieldKey,
          deltasResult.data,
          result,
          newEntityRefs,
        );
        if (isErr(expandResult)) return expandResult;
      } else {
        // single→multiple: should not happen (validation blocks it), keep as-is
        filteredChangeset[fieldKey] = change;
      }
    }

    if (isObjectNonEmpty(filteredChangeset)) {
      const existing = result[parentRef];
      result[parentRef] = existing
        ? { ...existing, ...filteredChangeset }
        : filteredChangeset;
    }
  }

  return ok(result);
};

/**
 * For each deleted entity, scan for other entities that reference its UID
 * in their fields JSON and add cleanup changesets (clear or remove mutations).
 *
 * For relation fields with `inverseOf`, cleanup is emitted only when
 * `expandInverseRelations` will not already cover the target — i.e. when the
 * deleted entity's own counterpart field doesn't carry a matching remove.
 * This keeps the healthy case single-emission while still cleaning up dangling
 * refs left behind by broken state.
 */
const expandDeleteCleanup = async <N extends NamespaceEditable>(
  tx: DbTransaction,
  namespace: N,
  changesets: EntitiesChangeset<N>,
  schema: NamespaceSchema<N>,
): ResultAsync<void> => {
  const table = editableEntityTables[namespace];

  // Collect UIDs of entities being deleted and, for each, the refs the
  // expansion will already remove for every inverseOf field.
  const deletedUids: string[] = [];
  const handledByExpansion = new Map<string, Map<FieldKey, Set<string>>>();
  for (const [, cs] of objEntries(changesets)) {
    if (!cs || !("uid" in cs)) continue;
    const uidChange = normalizeValueChange(cs.uid);
    if (!isClearChange(uidChange)) continue;
    const deletedUid = uidChange[1] as string;
    deletedUids.push(deletedUid);

    const perField = new Map<FieldKey, Set<string>>();
    handledByExpansion.set(deletedUid, perField);
    for (const [fieldKey, change] of objEntries(cs)) {
      const fieldDef = schema.fields[fieldKey];
      if (!fieldDef?.inverseOf) continue;
      const counterpart = fieldDef.inverseOf as FieldKey;
      const mutations = extractMutations(change);
      const refs = new Set<string>();
      if (mutations) {
        for (const m of mutations) {
          if (!isRemoveMutation(m)) continue;
          const ref = getRelationRef(m[1]) ?? (m[1] as string);
          if (typeof ref === "string") refs.add(ref);
        }
      } else {
        const normalized = normalizeValueChange(change);
        const values = isClearChange(normalized)
          ? toRelationArray(normalized[1])
          : [];
        for (const v of values) {
          const ref = getRelationRef(v) ?? (v as string);
          if (typeof ref === "string") refs.add(ref);
        }
      }
      perField.set(counterpart, refs);
    }
  }
  if (deletedUids.length === 0) return okVoid;

  for (const deletedUid of deletedUids) {
    const handled = handledByExpansion.get(deletedUid);
    // Find entities whose fields JSON contains the deleted UID
    const rows = await tx
      .select({ uid: table.uid, fields: table.fields })
      .from(table)
      .where(
        and(
          sql`${table.fields} LIKE ${"%" + deletedUid + "%"}`,
          ne(table.uid, deletedUid as EntityNsUid[N]),
        ),
      );

    for (const row of rows) {
      const entityRef = row.uid as EntityChangesetRef<N>;
      const fields = row.fields as Record<string, FieldValue>;

      for (const [fieldKey, value] of objEntries(fields)) {
        const fieldDef = schema.fields[fieldKey as FieldKey];
        if (!fieldDef || fieldDef.dataType !== "relation") continue;

        // For inverseOf fields, only emit cleanup when the deleted entity's
        // counterpart field won't drive the same removal through expansion.
        if (fieldDef.inverseOf) {
          const counterpartHandled = handled?.get(fieldKey as FieldKey);
          if (counterpartHandled?.has(row.uid as string)) continue;
        }

        const matchingItems = Array.isArray(value)
          ? (value as FieldValue[]).filter(
              (item) =>
                item === deletedUid ||
                (Array.isArray(item) && item[0] === deletedUid),
            )
          : [];
        if (matchingItems.length > 0) {
          const removeMutations: ListMutation[] = matchingItems.map(
            (item) => ["remove", item] as ListMutation,
          );
          mergeFieldInto(changesets, entityRef, fieldKey as FieldKey, [
            "seq",
            removeMutations,
          ]);
        } else if (value === deletedUid) {
          mergeFieldInto(changesets, entityRef, fieldKey as FieldKey, [
            "clear",
            deletedUid,
          ]);
        }
      }
    }
  }

  return okVoid;
};

const buildChangeset = async <N extends NamespaceEditable>(
  namespace: N,
  schema: NamespaceSchema<N>,
  input: EntityChangesetInput<N>,
  tx: DbTransaction,
  generateEntityId: () => EntityId,
  batchInputs: EntityChangesetInput<N>[],
): ResultAsync<[EntityChangesetRef<N>, FieldChangeset], ValidationError[]> => {
  if (isEntityDelete(input)) {
    const ref = getEntityInputRef(input);
    const entityResult = await fetchEntity(tx, namespace, ref);
    if (isErr(entityResult))
      return validationError(
        entityResult.error.message ?? entityResult.error.key,
      );
    const current = entityResult.data;
    const changesetRef = (
      namespace === "record" ? current.uid : assertDefinedPass(current.key)
    ) as EntityChangesetRef<N>;

    const changeset: FieldChangeset = {};
    for (const [key, value] of objEntries(current)) {
      if (key === "txIds") continue;
      if (value == null) continue;
      if (Array.isArray(value) && value.length > 0) {
        const fieldDef = schema.fields[key];
        const isMultiValue =
          key === "tags" ||
          !!(fieldDef && "allowMultiple" in fieldDef && fieldDef.allowMultiple);
        if (isMultiValue) {
          changeset[key] = [
            "seq",
            (value as FieldValue[]).map(
              (item) => ["remove", item] as ListMutation,
            ),
          ];
        } else {
          changeset[key] = ["clear", value];
        }
      } else if (!Array.isArray(value)) {
        changeset[key] = ["clear", value];
      }
    }
    return ok([changesetRef, changeset]);
  }

  const updatedSystemField = systemGeneratedFields.find(
    (field) => field in input,
  );
  if (updatedSystemField)
    return validationError(
      `system field ${updatedSystemField} not allowed in update`,
    );

  const changeset: FieldChangeset = {};
  let changesetRef: EntityChangesetRef<N>;
  let typeKey: EntityType;
  let currentEntityUid: EntityNsUid[N] | undefined;

  if (isEntityUpdate(input)) {
    const ref = getEntityInputRef(input);
    const keys = objKeys(input).filter((k) => k !== "$ref");
    assertNotEmpty(keys);
    const selectResult = await fetchEntityFieldset(tx, namespace, ref, [
      ...keys,
      "key",
      "uid",
      "type",
    ]);
    if (isErr(selectResult))
      return validationError(
        selectResult.error.message ?? selectResult.error.key,
      );
    const currentValues = selectResult.data;
    currentEntityUid = currentValues.uid as EntityNsUid[N];

    typeKey = currentValues.type as EntityType;
    const updateTypeDef = schema.types[typeKey];
    if (!updateTypeDef) {
      return validationError(`invalid type: ${typeKey}`, "type");
    }

    const validationErrors = validateChangesetInput(
      namespace,
      input,
      schema,
      typeKey,
    );
    if (validationErrors.length > 0) return err(validationErrors);

    const mergedValues = { ...currentValues, ...input } as Fieldset;
    const mandatoryErrors = validateConditionalMandatoryFields(
      schema,
      typeKey,
      mergedValues,
      keys,
    );
    if (mandatoryErrors.length > 0) return err(mandatoryErrors);

    for (const key of keys) {
      const currentValue = currentValues[key];
      const inputValue = input[key] as FieldValue;
      if (isDiffInput(inputValue)) {
        if (isTextDiffNoop(inputValue[1])) continue;
        changeset[key] = ["diff", inputValue[1]];
        continue;
      }
      const sequenceChange = toSeqChange(inputValue);
      if (sequenceChange !== inputValue) {
        changeset[key] = sequenceChange;
        continue;
      }
      const fieldDef = schema.fields[key];
      if (
        fieldDef &&
        typeof currentValue === "string" &&
        typeof inputValue === "string" &&
        getTextChangeType(fieldDef) === "diff"
      ) {
        const ops = computeTextDiff(currentValue, inputValue);
        if (isTextDiffNoop(ops)) continue;
        changeset[key] = ["diff", ops];
        continue;
      }
      // drop no-op sets: restating a field's existing value is not a change
      if (isEqual(inputValue, currentValue)) continue;
      changeset[key] =
        currentValue == null
          ? ["set", inputValue]
          : ["set", inputValue, currentValue];
    }
    changesetRef = (
      namespace === "record"
        ? currentValues.uid
        : assertDefinedPass(currentValues.key)
    ) as EntityChangesetRef<N>;
  } else {
    const newEntityId = generateEntityId();

    if (input["uid"] && !isValidUid(input["uid"])) {
      return validationError("invalid uid format", "uid");
    }
    if (!input.type) {
      return validationError(
        "type is required for create entity changeset",
        "type",
      );
    }

    typeKey = input.type as EntityType;
    const typeDef = schema.types[typeKey];
    if (!typeDef) {
      return validationError(`invalid type: ${typeKey}`, "type");
    }

    const validationErrors = validateChangesetInput(
      namespace,
      input,
      schema,
      typeKey,
    );
    if (validationErrors.length > 0) return err(validationErrors);

    const typeFieldKeys = typeDef.fields.map(getTypeFieldKey);
    const fieldAttrs = getFieldAttrs(schema, typeKey);

    const fieldsWithDefaults: Record<string, FieldValue> = {};
    for (const fieldKey of typeFieldKeys) {
      if (fieldKey in input) continue;

      const attrs = fieldAttrs.get(fieldKey);
      if (attrs?.value !== undefined) {
        fieldsWithDefaults[fieldKey] = attrs.value;
        continue;
      }
      if (attrs?.default !== undefined) {
        fieldsWithDefaults[fieldKey] = attrs.default;
        continue;
      }

      const fieldDef = schema.fields[fieldKey];
      if (fieldDef?.default !== undefined) {
        // TODO: later this should be a function
        if (fieldDef.when && !matchesFilters(fieldDef.when, input as Fieldset))
          continue;
        fieldsWithDefaults[fieldKey] = fieldDef.default as FieldValue;
      }
    }

    const entityData = {
      id: newEntityId,
      ...input,
      ...fieldsWithDefaults,
      uid: (input["uid"] ?? createUid()) as EntityUid,
    };
    for (const key of objKeys(entityData as Fieldset)) {
      changeset[key] = (entityData as Fieldset)[key];
    }
    changesetRef = (
      namespace === "record"
        ? entityData.uid
        : assertDefinedPass(entityData.key as ConfigKey)
    ) as EntityChangesetRef<N>;
  }

  if (namespace === "config") {
    if (typeKey === fieldSystemType) {
      const defaultErrors = validateFieldDefaultValue(
        input as EntityChangesetInput<"config">,
      );
      if (defaultErrors.length > 0) return err(defaultErrors);

      const inverseOfErrors = validateInverseOfField(
        input as EntityChangesetInput<"config">,
        schema,
        batchInputs as EntityChangesetInput<"config">[],
      );
      if (inverseOfErrors.length > 0) return err(inverseOfErrors);
    }

    if (typeKey === typeSystemType) {
      const defaultErrors = validateTypeFieldDefaults(
        input as EntityChangesetInput<"config">,
        schema,
      );
      if (defaultErrors.length > 0) return err(defaultErrors);
    }
  }

  const uniquenessResult = await validateUniquenessConstraints(
    tx,
    namespace,
    input,
    schema,
    currentEntityUid,
  );
  if (isErr(uniquenessResult))
    return validationError(
      uniquenessResult.error.message ?? uniquenessResult.error.key,
    );
  if (uniquenessResult.data.length > 0) return err(uniquenessResult.data);

  return ok([changesetRef, changeset]);
};

/**
 * Upsert pre-pass: an input with both `type` and a `key`/`uid` leaves the
 * create-vs-update choice to the system rather than the author. Existence is
 * resolved here, before relation/uid resolution, so a matched entity keeps its
 * uid instead of being minted a fresh one.
 *
 * Routing keys off `type` alone, never `$ref`, so `$ref` keeps its single role
 * as an identifier-kind selector.
 */
const resolveUpserts = async <N extends NamespaceEditable>(
  tx: DbTransaction,
  namespace: N,
  inputs: ChangesetsInput<N>,
): ResultAsync<ChangesetsInput<N>, ErrorObject> => {
  const candidates: { index: number; ref: EntityRef }[] = [];
  for (let index = 0; index < inputs.length; index++) {
    const input = inputs[index];
    // Only a potential create that carries an identifier is upsert intent.
    // `$ref` stays a pure selector and is never valid on a create.
    if (!isEntityCreate(input)) continue;
    const raw = input as Record<string, unknown>;
    if ("$ref" in raw) continue;
    const ref = (raw["uid"] ?? raw["key"]) as EntityRef | undefined;
    if (ref != null) candidates.push({ index, ref });
  }

  if (candidates.length === 0) return ok(inputs);

  const existingResult = await resolveExistingEntities(
    tx,
    namespace,
    candidates.map((candidate) => candidate.ref),
  );
  if (isErr(existingResult)) return existingResult;
  const existing = existingResult.data;

  const result = [...inputs];
  const errors: ChangesetValidationError[] = [];

  for (const { index, ref } of candidates) {
    const match = existing.get(String(ref));
    if (!match) continue; // miss → stays a create

    const raw = inputs[index] as Record<string, unknown>;
    const inputType = raw["type"] as string;
    if (inputType !== match.type) {
      errors.push({
        index,
        namespace,
        field: "type",
        message: `type "${inputType}" does not match existing ${namespace} entity ${ref} of type "${match.type}"`,
      });
      continue;
    }

    // Drop the create marker; the existing key/uid then routes through the
    // normal update path during normalization. No `$ref` is introduced here.
    const { type: _type, ...rest } = raw;
    result[index] = rest as EntityChangesetInput<N>;
  }

  if (errors.length > 0) {
    return fail("changeset-input-process-failed", "failed creating changeset", {
      data: { errors },
    });
  }

  return ok(result);
};

/**
 * Normalizes entity mutation inputs into per-entity field changesets, resolving
 * relation refs, validating constraints, expanding inverse relation side effects,
 * and adding reference cleanup for deletes before the transaction is applied.
 */
export const processChangesetInput = async <N extends NamespaceEditable>(
  tx: DbTransaction,
  namespace: N,
  inputs: ChangesetsInput<N>,
  schema: NamespaceSchema<N>,
  lastEntityId: EntityId,
): ResultAsync<EntitiesChangeset<N>, ErrorObject> => {
  const upsertResult = await resolveUpserts(tx, namespace, inputs);
  if (isErr(upsertResult)) return upsertResult;

  const normalizedInputs = upsertResult.data.map((raw) =>
    normalizeInput(raw, schema),
  );

  const refToUidResult =
    namespace === "record"
      ? await buildRefToUidMap(tx, normalizedInputs, schema)
      : ok(new Map<string, EntityUid>());
  if (isErr(refToUidResult)) return refToUidResult;
  const refToUid = refToUidResult.data;

  let lastId =
    namespace === "config"
      ? (Math.max(lastEntityId, CONFIG_APP_ID_OFFSET - 1) as EntityId)
      : lastEntityId;
  const generateEntityId = () => {
    lastId = incrementEntityId(lastId);
    return lastId;
  };

  const changesetResults = await Promise.all(
    normalizedInputs.map(async (input, index) => {
      const resolvedInput = resolveRelations(input, schema, refToUid);
      const result = await buildChangeset(
        namespace,
        schema,
        resolvedInput,
        tx,
        generateEntityId,
        normalizedInputs,
      );
      if (isErr(result))
        return err(result.error.map((it) => ({ ...it, index, namespace })));
      return result;
    }),
  );

  const errorResults = changesetResults.filter(isErr);
  if (errorResults.length > 0) {
    return fail("changeset-input-process-failed", "failed creating changeset", {
      data: { errors: errorResults.flatMap((it) => it.error) },
    });
  }

  const rawChangesets = Object.fromEntries(
    changesetResults.map(throwIfError),
  ) as EntitiesChangeset<N>;

  // For deletes, find and clean up incoming references from other entities
  if (normalizedInputs.some(isEntityDelete)) {
    const cleanupResult = await expandDeleteCleanup(
      tx,
      namespace,
      rawChangesets,
      schema,
    );
    if (isErr(cleanupResult)) return cleanupResult;
  }

  return expandInverseRelations(tx, namespace, rawChangesets, schema);
};
