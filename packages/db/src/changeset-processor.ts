import {
  assert,
  assertDefined,
  assertDefinedPass,
  assertFailed,
  assertNotEmpty,
  err,
  type ErrorObject,
  fail,
  includes,
  isErr,
  isTuple,
  objEntries,
  objKeys,
  ok,
  type Result,
  type ResultAsync,
  throwIfError,
  tryCatch,
} from "@binder/utils";
import { and, eq, ne, sql } from "drizzle-orm";
import { createUid, isValidUid } from "./utils/uid.ts";
import {
  applyChangeset as applyChangesetModel,
  type ChangesetsInput,
  type ConfigKey,
  coreIdentityFieldKeys,
  type DataTypeNs,
  emptyFieldset,
  type EntitiesChangeset,
  type EntityChangesetInput,
  type EntityChangesetRef,
  type EntityId,
  type EntityNsRef,
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
  getFieldDef,
  getTypeFieldAttrs,
  getTypeFieldKey,
  incrementEntityId,
  isClearChange,
  isEntityUpdate,
  isListMutation,
  isListMutationArray,
  isListMutationInput,
  isListMutationInputArray,
  isPatchMutation,
  isReservedEntityKey,
  isSetChange,
  type ListMutation,
  type ListMutationInput,
  type NamespaceEditable,
  type NamespaceSchema,
  type NodeFieldDef,
  type NodeKey,
  type NodeSchema,
  normalizeInputValue,
  normalizeListMutationInput,
  normalizeOptionSet,
  normalizeValueChange,
  type OptionDef,
  type OptionDefInput,
  resolveEntityRefType,
  type TypeDef,
  type TypeFieldRef,
  typeSystemType,
  USER_CONFIG_ID_OFFSET,
} from "./model";
import type { DbTransaction } from "./db.ts";
import {
  createEntity,
  deleteEntity,
  fetchEntityFieldset,
  resolveEntityRefs,
  updateEntity,
} from "./entity-store.ts";
import { validateDataType } from "./data-type-validators.ts";
import { editableEntityTables } from "./schema.ts";
import { matchesFilters } from "./filter-entities.ts";

const systemGeneratedFields = ["id", "txIds"] as const;

const fieldsToExcludeFromValidation = [
  ...coreIdentityFieldKeys,
  "txIds",
  "$ref",
] as const;

type ValidationError = {
  field?: string;
  message: string;
};

export type ChangesetValidationError = ValidationError & {
  namespace: NamespaceEditable;
  index: number;
};

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

const validateFieldDefaultValue = (
  input: EntityChangesetInput<"config">,
  existingEntity: Fieldset | undefined,
): ValidationError[] => {
  const errors: ValidationError[] = [];

  const defaultValue = input["default"] as FieldValue | undefined;
  if (defaultValue === undefined) return errors;

  const dataType =
    (input["dataType"] as string) ?? existingEntity?.["dataType"];
  if (!dataType) return errors;

  const inputOptions = input["options"] as OptionDefInput[] | undefined;
  const options = inputOptions
    ? normalizeOptionSet(inputOptions)
    : (existingEntity?.["options"] as OptionDef[] | undefined);

  const tempFieldDef = {
    dataType,
    allowMultiple: false,
    options,
  } as NodeFieldDef;
  const validationResult = validateDataType("node", tempFieldDef, defaultValue);

  if (isErr(validationResult)) {
    errors.push({
      field: "default",
      message: `default value does not match dataType '${dataType}': ${validationResult.error.message}`,
    });
  }

  return errors;
};

const validateTypeFieldDefaults = (
  input: EntityChangesetInput<"config">,
  schema: EntitySchema,
): ValidationError[] => {
  const errors: ValidationError[] = [];

  const fields = input["fields"] as TypeFieldRef[] | undefined;
  if (!fields || !Array.isArray(fields)) return errors;

  for (const fieldRef of fields) {
    const attrs = getTypeFieldAttrs(fieldRef);
    if (!attrs?.default) continue;

    const fieldKey = getTypeFieldKey(fieldRef);
    const fieldDef = getFieldDef(schema, fieldKey);
    if (!fieldDef) continue;

    const tempFieldDef = {
      dataType: fieldDef.dataType,
      allowMultiple: false,
      options: fieldDef.options,
    } as NodeFieldDef;
    const validationResult = validateDataType(
      "node",
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
  input: EntityChangesetInput<N>,
  schema: EntitySchema,
): ValidationError[] => {
  const errors: ValidationError[] = [];

  const keyValue = input["key"] as string;
  if (keyValue !== undefined && isReservedEntityKey(keyValue)) {
    errors.push({
      field: "key",
      message: `key "${keyValue}" is reserved and cannot be used`,
    });
  }

  for (const fieldKey of objKeys(input)) {
    if (fieldsToExcludeFromValidation.includes(fieldKey as any)) {
      continue;
    }
    const fieldDef = getFieldDef(schema, fieldKey) as
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

    if (isEntityUpdate(input)) {
      if (fieldDef.immutable) {
        errors.push({
          field: fieldKey,
          message: "field is immutable and cannot be updated",
        });
        continue;
      }
    } else {
      const typeKey = (input as any).type;
      if (typeKey) {
        const fieldAttrs = getFieldAttrs(schema, typeKey);
        const attrs = fieldAttrs.get(fieldKey);
        if (attrs?.value !== undefined && value !== attrs.value) {
          errors.push({
            field: fieldKey,
            message: `field must have value "${attrs.value}", got: ${value}`,
          });
          continue;
        }
      }
    }

    if (isListMutationArray(value)) {
      for (const mutation of value) {
        if (isPatchMutation(mutation)) {
          errors.push(
            ...validatePatchAttrs(
              namespace,
              fieldKey,
              fieldDef,
              mutation[2],
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
      continue;
    }

    if (isListMutation(value)) {
      if (isPatchMutation(value)) {
        errors.push(
          ...validatePatchAttrs(
            namespace,
            fieldKey,
            fieldDef,
            value[2],
            schema,
          ),
        );
        continue;
      }
      const [kind, mutationValue] = value;
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
      continue;
    }

    if (fieldDef.unique && fieldDef.allowMultiple) {
      errors.push({
        field: fieldKey,
        message: "unique constraint cannot be used with allowMultiple",
      });
      continue;
    }

    const validationResult = validateDataType(namespace, fieldDef, value);

    if (isErr(validationResult)) {
      errors.push({
        field: fieldKey,
        message: validationResult.error.message ?? "validation failed",
      });
    }
  }

  if (isEntityUpdate(input)) return errors;

  if (!input.type) {
    errors.push({
      field: "type",
      message: "type is required for create entity changeset",
    });
    return errors;
  }

  const typeKey = input.type;
  const typeDef = (schema.types as any)[typeKey];

  if (!typeDef) {
    errors.push({
      field: "type",
      message: `invalid type: ${typeKey}`,
    });
    return errors;
  }

  const fieldAttrs = getFieldAttrs(schema, typeKey);
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
      getFieldDef(schema, fieldKey)?.default !== undefined;
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
  input: EntityChangesetInput<N>,
  schema: EntitySchema,
  currentEntityUid?: EntityNsUid[N],
): ResultAsync<ValidationError[]> => {
  const errors: ValidationError[] = [];
  const table = editableEntityTables[namespace];

  for (const [fieldKey, value] of Object.entries(input)) {
    if (value == null) continue;
    const fieldDef = (schema.fields as any)[fieldKey];
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
              ? eq(table.key, value as NodeKey | ConfigKey)
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

export const applyChangeset = async <N extends NamespaceEditable>(
  tx: DbTransaction,
  namespace: N,
  entityRef: EntityNsRef[N],
  changeset: FieldChangeset,
): ResultAsync<void> => {
  if (Object.keys(changeset).length === 0) return ok(undefined);

  if ("id" in changeset) {
    const idChange = normalizeValueChange(changeset.id);
    assert(
      isSetChange(idChange) || isClearChange(idChange),
      "changeset.id must be set or clear",
    );

    if (isSetChange(idChange) && idChange.length === 2) {
      assertDefined(changeset.type, "changeset.type");
      const patch = applyChangesetModel(emptyFieldset, changeset);
      return await createEntity(tx, namespace, {
        ...patch,
        [resolveEntityRefType(entityRef)]: entityRef,
      });
    }
    if (isClearChange(idChange)) {
      return await deleteEntity(tx, namespace, entityRef);
    }
    assertFailed("id can only be set or cleared");
  } else {
    const keys: FieldKey[] = Object.keys(changeset);
    const selectResult = await fetchEntityFieldset(
      tx,
      namespace,
      entityRef,
      keys,
    );
    if (isErr(selectResult)) return selectResult;

    const currentValues = selectResult.data;
    const patch = applyChangesetModel(currentValues, changeset);
    return await updateEntity(tx, namespace, entityRef, patch);
  }
};

const validationError = <R>(
  message: string,
  field?: string,
): Result<R, ValidationError[]> => err([{ field, message }]);

export const applyConfigChangesetToSchema = (
  baseSchema: NodeSchema,
  configurationsChangeset: EntitiesChangeset<"config">,
): NodeSchema => {
  const newFields: NodeSchema["fields"] = { ...baseSchema.fields };
  const newTypes: NodeSchema["types"] = { ...baseSchema.types };

  for (const [configKey, changeset] of Object.entries(
    configurationsChangeset,
  )) {
    const idChange = changeset.id ? normalizeValueChange(changeset.id) : null;

    if (idChange && isSetChange(idChange) && idChange.length === 2) {
      const entity = applyChangesetModel(emptyFieldset, changeset);

      if (includes(fieldTypes, entity.type)) {
        const field = entity as NodeFieldDef;
        newFields[field.key] = field;
      } else if (entity.type === typeSystemType) {
        const type = entity as TypeDef;
        newTypes[type.key as EntityType] = type;
      }
    } else if (!idChange) {
      const existingField = newFields[configKey as FieldKey];
      const existingType = newTypes[configKey as EntityType];

      if (existingField) {
        const updated = applyChangesetModel(existingField, changeset);
        newFields[configKey as FieldKey] = updated as NodeFieldDef;
      } else if (existingType) {
        const updated = applyChangesetModel(existingType, changeset);
        newTypes[configKey as EntityType] = updated as TypeDef;
      }
    }
  }

  return {
    fields: newFields,
    types: newTypes,
  };
};

type RefToUidMap = Map<string, EntityUid>;

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
      if (fieldKey === "$ref" || fieldKey === "type" || value === undefined)
        continue;
      const fieldDef = getFieldDef(schema, fieldKey);
      if (fieldDef?.dataType !== "relation") continue;

      const fieldValue = value as FieldValue;
      if (isListMutationArray(fieldValue)) {
        for (const mutation of fieldValue as ListMutation[]) {
          if (mutation[0] !== "patch") collectFromValue(mutation[1]);
        }
      } else if (isListMutation(fieldValue)) {
        if (fieldValue[0] !== "patch") collectFromValue(fieldValue[1]);
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
    if (isEntityUpdate(input)) continue;

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

  const resolvedResult = await resolveEntityRefs(tx, "node", refsToResolve);
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

const normalizeFieldValue = (
  fieldDef: FieldDef | undefined,
  value: FieldValue,
): FieldValue | ListMutation | ListMutation[] => {
  if (isListMutationInputArray(value)) {
    return (value as ListMutationInput[]).map(normalizeListMutationInput);
  }
  if (isListMutationInput(value)) {
    return normalizeListMutationInput(value as ListMutationInput);
  }
  if (fieldDef?.dataType === "optionSet" && Array.isArray(value)) {
    return normalizeOptionSet(value as OptionDefInput[]);
  }
  if (fieldDef?.dataType === "relation") {
    return normalizeInputValue(value);
  }
  return value;
};

const normalizeInput = <N extends NamespaceEditable>(
  input: EntityChangesetInput<N>,
  schema: NamespaceSchema<N>,
): EntityChangesetInput<N> => {
  const normalized: EntityChangesetInput<N> = { ...input };

  for (const [fieldKey, value] of objEntries(input)) {
    if (fieldKey === "$ref" || fieldKey === "type" || value === undefined)
      continue;

    const fieldDef = getFieldDef(schema, fieldKey);
    normalized[fieldKey] = normalizeFieldValue(
      fieldDef,
      value as FieldValue,
    ) as typeof value;
  }

  return normalized;
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
  const resolved: EntityChangesetInput<N> = { ...input };

  for (const [fieldKey, value] of objEntries(input)) {
    if (fieldKey === "$ref" || fieldKey === "type" || value === undefined)
      continue;

    const fieldDef = getFieldDef(schema, fieldKey);
    if (fieldDef?.dataType !== "relation") continue;

    const fieldValue = value as FieldValue;

    if (isListMutationArray(fieldValue)) {
      resolved[fieldKey] = (fieldValue as ListMutation[]).map((m) =>
        resolveRelationMutation(fieldDef, m, refToUid),
      ) as typeof value;
    } else if (isListMutation(fieldValue)) {
      resolved[fieldKey] = resolveRelationMutation(
        fieldDef,
        fieldValue as ListMutation,
        refToUid,
      ) as typeof value;
    } else {
      resolved[fieldKey] = resolveRelationFieldValue(
        fieldDef,
        fieldValue,
        refToUid,
      ) as typeof value;
    }
  }

  return resolved;
};

const buildChangeset = async <N extends NamespaceEditable>(
  namespace: N,
  schema: NamespaceSchema<N>,
  input: EntityChangesetInput<N>,
  tx: DbTransaction,
  generateEntityId: () => EntityId,
): ResultAsync<[EntityChangesetRef<N>, FieldChangeset], ValidationError[]> => {
  const updatedSystemField = systemGeneratedFields.find(
    (field) => field in input,
  );
  if (updatedSystemField)
    return validationError(
      `system field ${updatedSystemField} not allowed in update`,
    );

  const validationErrors = validateChangesetInput(namespace, input, schema);
  if (validationErrors.length > 0) return err(validationErrors);

  const changeset: FieldChangeset = {};
  let changesetRef: EntityChangesetRef<N>;
  let typeKey: EntityType;

  if (isEntityUpdate(input)) {
    const ref = input.$ref as EntityNsRef[N];
    const keys = Object.keys(input).filter((k) => k !== "$ref") as FieldKey[];
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

    typeKey = currentValues.type as EntityType;
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
      const inputValue = input[key];
      if (isListMutationArray(inputValue)) {
        changeset[key] = ["seq", inputValue];
      } else if (isListMutation(inputValue)) {
        changeset[key] = ["seq", [inputValue]];
      } else {
        changeset[key] =
          currentValue == null
            ? ["set", inputValue]
            : ["set", inputValue, currentValue];
      }
    }
    changesetRef = (
      namespace === "node"
        ? currentValues.uid
        : assertDefinedPass(currentValues.key)
    ) as EntityChangesetRef<N>;
  } else {
    const newEntityId = generateEntityId();

    if (input["uid"] && !isValidUid(input["uid"])) {
      return validationError("invalid uid format", "uid");
    }
    if (namespace === "config" && !input["key"]) {
      return validationError("key is required for config entities", "key");
    }

    typeKey = input.type as EntityType;

    const typeDef = schema.types[typeKey];
    const typeFieldKeys = typeDef?.fields.map(getTypeFieldKey) ?? [];
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

      const fieldDef = getFieldDef(schema, fieldKey);
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
    for (const key of Object.keys(entityData) as FieldKey[]) {
      changeset[key] = (entityData as Fieldset)[key];
    }
    changesetRef = (
      namespace === "node"
        ? entityData.uid
        : assertDefinedPass(entityData.key as ConfigKey)
    ) as EntityChangesetRef<N>;
  }

  if (namespace === "config") {
    if (typeKey === fieldSystemType) {
      const defaultErrors = validateFieldDefaultValue(
        input as EntityChangesetInput<"config">,
        undefined,
      );
      if (defaultErrors.length > 0) return err(defaultErrors);
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
    undefined,
  );
  if (isErr(uniquenessResult))
    return validationError(
      uniquenessResult.error.message ?? uniquenessResult.error.key,
    );
  if (uniquenessResult.data.length > 0) return err(uniquenessResult.data);

  return ok([changesetRef, changeset]);
};

export const processChangesetInput = async <N extends NamespaceEditable>(
  tx: DbTransaction,
  namespace: N,
  inputs: ChangesetsInput<N>,
  schema: NamespaceSchema<N>,
  lastEntityId: EntityId,
): ResultAsync<
  EntitiesChangeset<N>,
  ErrorObject<{ errors?: ChangesetValidationError[] }>
> => {
  const normalizedInputs = inputs.map((raw) => normalizeInput(raw, schema));

  const refToUidResult =
    namespace === "node"
      ? await buildRefToUidMap(tx, normalizedInputs, schema)
      : ok(new Map<string, EntityUid>());
  if (isErr(refToUidResult)) return refToUidResult;
  const refToUid = refToUidResult.data;

  let lastId =
    namespace === "config"
      ? (Math.max(lastEntityId, USER_CONFIG_ID_OFFSET - 1) as EntityId)
      : lastEntityId;
  const generateEntityId = () => {
    const newEntityId = incrementEntityId(lastId);
    lastId = newEntityId;
    return newEntityId;
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
      );
      if (isErr(result))
        return err(result.error.map((it) => ({ ...it, index, namespace })));
      return result;
    }),
  );

  const errorResults = changesetResults.filter(isErr);
  if (errorResults.length > 0) {
    return fail("changeset-input-process-failed", "failed creating changeset", {
      errors: errorResults.flatMap((it) => it.error),
    });
  }

  return ok(
    Object.fromEntries(
      changesetResults.map(throwIfError),
    ) as EntitiesChangeset<N>,
  );
};
