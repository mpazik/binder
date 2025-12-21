import {
  assert,
  assertDefined,
  assertDefinedPass,
  assertFailed,
  assertNotEmpty,
  createError,
  err,
  fail,
  includes,
  isErr,
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
  emptyFieldset,
  type EntitiesChangeset,
  type EntityChangesetInput,
  type EntityChangesetRef,
  type EntityId,
  type EntityNsRef,
  type EntityUid,
  type EntityNsUid,
  type EntitySchema,
  type EntityType,
  type FieldAttrDef,
  getTypeFieldAttrs,
  getTypeFieldKey,
  type FieldChangeset,
  type FieldDef,
  type FieldKey,
  fieldSystemType,
  fieldTypes,
  type Fieldset,
  type FieldValue,
  getFieldDef,
  getMutationInputRef,
  incrementEntityId,
  isClearChange,
  isEntityUpdate,
  isListMutationInput,
  isListMutationInputArray,
  type ListMutationInputPatch,
  isReservedEntityKey,
  isSetChange,
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
  type DataTypeNs,
  USER_CONFIG_ID_OFFSET,
} from "./model";
import type { DbTransaction } from "./db.ts";
import {
  createEntity,
  deleteEntity,
  fetchEntityFieldset,
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

const normalizeValueForField = (
  schema: EntitySchema,
  fieldKey: FieldKey,
  value: FieldValue,
): FieldValue => {
  const fieldDef = getFieldDef(schema, fieldKey);
  if (fieldDef?.dataType === "relation") {
    return normalizeInputValue(value);
  }
  if (fieldDef?.dataType === "optionSet" && Array.isArray(value)) {
    return normalizeOptionSet(value as OptionDefInput[]);
  }
  return value;
};

export type ChangesetValidationError = {
  fieldKey: string;
  message: string;
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
): ChangesetValidationError[] => {
  const errors: ChangesetValidationError[] = [];
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
      fieldKey,
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
): ChangesetValidationError[] => {
  const errors: ChangesetValidationError[] = [];
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
        fieldKey: `${fieldKey}.${attrKey}`,
        message: validationResult.error.message ?? "validation failed",
      });
    }
  }

  return errors;
};

const validateFieldDefaultValue = (
  input: EntityChangesetInput<"config">,
  existingEntity: Fieldset | undefined,
): ChangesetValidationError[] => {
  const errors: ChangesetValidationError[] = [];

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
      fieldKey: "default",
      message: `default value does not match dataType '${dataType}': ${validationResult.error.message}`,
    });
  }

  return errors;
};

const validateTypeFieldDefaults = (
  input: EntityChangesetInput<"config">,
  schema: EntitySchema,
): ChangesetValidationError[] => {
  const errors: ChangesetValidationError[] = [];

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
        fieldKey: `fields.${fieldKey}.default`,
        message: `default value does not match dataType '${fieldDef.dataType}': ${validationResult.error.message}`,
      });
    }
  }

  return errors;
};

const isPatchMutationInput = (
  mutation: unknown,
): mutation is ListMutationInputPatch =>
  Array.isArray(mutation) && mutation[0] === "patch";

const validateChangesetInput = <N extends NamespaceEditable>(
  namespace: N,
  input: EntityChangesetInput<N>,
  schema: EntitySchema,
): ChangesetValidationError[] => {
  const errors: ChangesetValidationError[] = [];

  const keyValue = input["key"] as string;
  if (keyValue !== undefined && isReservedEntityKey(keyValue)) {
    errors.push({
      fieldKey: "key",
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
        fieldKey,
        message: `field "${fieldKey}" is not defined in schema`,
      });
      continue;
    }
    const value = input[fieldKey];

    if (value == null) continue;

    if (isEntityUpdate(input)) {
      if (fieldDef.immutable) {
        errors.push({
          fieldKey,
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
            fieldKey,
            message: `field must have value "${attrs.value}", got: ${value}`,
          });
          continue;
        }
      }
    }

    if (isListMutationInputArray(value)) {
      for (const mutation of value) {
        if (isPatchMutationInput(mutation)) {
          const patchErrors = validatePatchAttrs(
            namespace,
            fieldKey,
            fieldDef,
            mutation[2],
            schema,
          );
          errors.push(...patchErrors);
          continue;
        }
        const [kind, mutationValue] = mutation;
        const singleValueFieldDef = { ...fieldDef, allowMultiple: false };
        const validationResult = validateDataType(
          namespace,
          singleValueFieldDef,
          getMutationInputRef(mutationValue),
        );
        if (isErr(validationResult)) {
          errors.push({
            fieldKey,
            message: `Invalid ${kind} value: ${validationResult.error.message}`,
          });
        }
      }
      continue;
    }

    if (isListMutationInput(value)) {
      if (isPatchMutationInput(value)) {
        const patchErrors = validatePatchAttrs(
          namespace,
          fieldKey,
          fieldDef,
          value[2],
          schema,
        );
        errors.push(...patchErrors);
        continue;
      }
      const [kind, mutationValue] = value;
      const singleValueFieldDef = { ...fieldDef, allowMultiple: false };
      const validationResult = validateDataType(
        namespace,
        singleValueFieldDef,
        getMutationInputRef(mutationValue),
      );
      if (isErr(validationResult)) {
        errors.push({
          fieldKey,
          message: `Invalid ${kind} value: ${validationResult.error.message}`,
        });
      }
      continue;
    }

    if (fieldDef.unique && fieldDef.allowMultiple) {
      errors.push({
        fieldKey,
        message: "unique constraint cannot be used with allowMultiple",
      });
      continue;
    }

    const normalizedValue = normalizeValueForField(schema, fieldKey, value);
    const validationResult = validateDataType(
      namespace,
      fieldDef,
      normalizedValue,
    );

    if (isErr(validationResult)) {
      errors.push({
        fieldKey,
        message: validationResult.error.message ?? "validation failed",
      });
    }
  }

  if (isEntityUpdate(input)) return errors;

  if (!input.type) {
    errors.push({
      fieldKey: "type",
      message: "type is required for create entity changeset",
    });
    return errors;
  }

  const typeKey = input.type;
  const typeDef = (schema.types as any)[typeKey];

  if (!typeDef) {
    errors.push({
      fieldKey: "type",
      message: `invalid type: ${typeKey}`,
    });
    return errors;
  }

  const fieldAttrs = getFieldAttrs(schema, typeKey);
  // For creates, input contains all entity values needed to evaluate `when` conditions.
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
        fieldKey,
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
): ResultAsync<ChangesetValidationError[]> => {
  const errors: ChangesetValidationError[] = [];
  const table = editableEntityTables[namespace];

  for (const [fieldKey, value] of Object.entries(input)) {
    if (value == null) continue;
    const fieldDef = (schema.fields as any)[fieldKey];
    if (!fieldDef || !fieldDef.unique) continue;
    if (fieldDef.allowMultiple) {
      errors.push({
        fieldKey,
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
        fieldKey,
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

const validationError = <N, E, R>(
  index: number,
  namespace: N,
  errors: E,
): Result<R> =>
  err(
    createError("changeset-validation-failed", "changeset validation failed", {
      index,
      namespace,
      errors,
    }),
  );

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

export const processChangesetInput = async <N extends NamespaceEditable>(
  tx: DbTransaction,
  namespace: N,
  input: ChangesetsInput<N>,
  schema: NamespaceSchema<N>,
  lastEntityId: EntityId,
): ResultAsync<EntitiesChangeset<N>> => {
  let lastId =
    namespace === "config"
      ? (Math.max(lastEntityId, USER_CONFIG_ID_OFFSET - 1) as EntityId)
      : lastEntityId;
  const buildChangeset = async (
    input: EntityChangesetInput<N>,
    index: number,
  ): ResultAsync<[EntityChangesetRef<N>, FieldChangeset]> => {
    const updatedSystemField = systemGeneratedFields.find(
      (field) => field in input,
    );
    if (updatedSystemField)
      return err(
        createError(
          "invalid-input",
          `system field ${updatedSystemField} not allowed in update`,
        ),
      );

    const validationErrors = validateChangesetInput(namespace, input, schema);
    if (validationErrors.length > 0)
      return validationError(index, namespace, validationErrors);

    const changeset: FieldChangeset = {};
    let changesetRef: EntityChangesetRef<N>;
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
      if (isErr(selectResult)) return selectResult;
      const currentValues = selectResult.data;
      const uniquenessResult = await validateUniquenessConstraints(
        tx,
        namespace,
        input,
        schema,
        currentValues["uid"] as EntityNsUid[N],
      );
      if (isErr(uniquenessResult)) return uniquenessResult;
      if (uniquenessResult.data.length > 0)
        return validationError(index, namespace, uniquenessResult.data);

      const typeKey = currentValues.type as EntityType;
      const mergedValues = { ...currentValues, ...input } as Fieldset;
      const mandatoryErrors = validateConditionalMandatoryFields(
        schema,
        typeKey,
        mergedValues,
        keys,
      );
      if (mandatoryErrors.length > 0)
        return validationError(index, namespace, mandatoryErrors);

      if (namespace === "config" && typeKey === fieldSystemType) {
        const defaultErrors = validateFieldDefaultValue(
          input as EntityChangesetInput<"config">,
          currentValues,
        );
        if (defaultErrors.length > 0)
          return validationError(index, namespace, defaultErrors);
      }

      if (namespace === "config" && typeKey === typeSystemType) {
        const defaultErrors = validateTypeFieldDefaults(
          input as EntityChangesetInput<"config">,
          schema,
        );
        if (defaultErrors.length > 0)
          return validationError(index, namespace, defaultErrors);
      }

      for (const key of keys) {
        const currentValue = currentValues[key];
        const inputValue = input[key];
        if (isListMutationInputArray(inputValue)) {
          changeset[key] = ["seq", inputValue.map(normalizeListMutationInput)];
        } else if (isListMutationInput(inputValue)) {
          changeset[key] = ["seq", [normalizeListMutationInput(inputValue)]];
        } else {
          const normalizedValue = normalizeValueForField(
            schema,
            key,
            inputValue as FieldValue,
          );
          if (currentValue === undefined || currentValue === null) {
            changeset[key] = ["set", normalizedValue];
          } else {
            changeset[key] = ["set", normalizedValue, currentValue];
          }
        }
      }
      changesetRef = (
        namespace === "node"
          ? currentValues.uid
          : assertDefinedPass(currentValues.key)
      ) as EntityChangesetRef<N>;
    } else {
      const newEntityId = incrementEntityId(lastId);
      lastId = newEntityId;

      if (input["uid"] && !isValidUid(input["uid"])) {
        return validationError(index, namespace, [
          { fieldKey: "uid", message: "invalid uid format" },
        ]);
      }
      if (namespace === "config" && !input["key"]) {
        return validationError(index, namespace, [
          { fieldKey: "key", message: "key is required for config entities" },
        ]);
      }

      const typeKey = input.type as EntityType;

      if (namespace === "config" && typeKey === fieldSystemType) {
        const defaultErrors = validateFieldDefaultValue(
          input as EntityChangesetInput<"config">,
          undefined,
        );
        if (defaultErrors.length > 0)
          return validationError(index, namespace, defaultErrors);
      }

      if (namespace === "config" && typeKey === typeSystemType) {
        const defaultErrors = validateTypeFieldDefaults(
          input as EntityChangesetInput<"config">,
          schema,
        );
        if (defaultErrors.length > 0)
          return validationError(index, namespace, defaultErrors);
      }

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
          fieldsWithDefaults[fieldKey] = fieldDef.default as FieldValue;
        }
      }

      const entityData = {
        id: newEntityId,
        ...input,
        ...fieldsWithDefaults,
        uid: (input["uid"] ?? createUid()) as EntityUid,
      };
      const keys = Object.keys(entityData) as FieldKey[];
      for (const key of keys) {
        changeset[key] = normalizeValueForField(
          schema,
          key,
          (entityData as any)[key],
        );
      }
      changesetRef = (
        namespace === "node"
          ? entityData.uid
          : assertDefinedPass(entityData.key as ConfigKey)
      ) as EntityChangesetRef<N>;
    }

    const uniquenessResult = await validateUniquenessConstraints(
      tx,
      namespace,
      input,
      schema,
      undefined,
    );
    if (isErr(uniquenessResult)) return uniquenessResult;
    if (uniquenessResult.data.length > 0)
      return validationError(index, namespace, uniquenessResult.data);

    return ok([changesetRef, changeset]);
  };

  const changesetResults = await Promise.all(
    input.map((item, index) => buildChangeset(item, index)),
  );
  const errorResults = changesetResults.filter((it) => isErr(it));
  if (errorResults.length > 0) {
    const flattenedErrors = [];
    for (const errorResult of errorResults) {
      const error = errorResult.error;
      if (error.key === "changeset-validation-failed") {
        const validationData = error.data as any;
        const fieldErrors = validationData.errors || [];
        for (const fieldError of fieldErrors) {
          flattenedErrors.push({
            changesetIndex: validationData.index,
            namespace: validationData.namespace,
            fieldKey: fieldError.fieldKey,
            message: fieldError.message,
          });
        }
      } else {
        flattenedErrors.push(error);
      }
    }
    return fail("changeset-input-process-failed", "failed creating changeset", {
      errors: flattenedErrors,
    });
  }

  return ok(
    Object.fromEntries(
      changesetResults.map((it) => throwIfError(it)),
    ) as EntitiesChangeset<N>,
  );
};
