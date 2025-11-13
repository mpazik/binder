import {
  assertDefined,
  assertDefinedPass,
  assertEqual,
  assertFailed,
  assertNotEmpty,
  createError,
  err,
  errorToObject,
  isErr,
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
  emptyFieldset,
  type EntitiesChangeset,
  type EntityChangesetInput,
  type EntityChangesetRef,
  type EntityId,
  type EntityNsRef,
  type EntityNsSchema,
  type EntityNsType,
  type EntityNsUid,
  type EntityUid,
  type FieldAttrDefs,
  type FieldChangeset,
  type FieldKey,
  fieldNodeTypes,
  incrementEntityId,
  isEntityUpdate,
  isListMutation,
  isListMutationArray,
  type NamespaceEditable,
  normalizeValueChange,
  type NodeFieldDefinition,
  type NodeKey,
  type NodeSchema,
  type NodeTypeDefinition,
  typeConfigType,
  resolveEntityRefType,
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

const systemGeneratedFields = ["id", "txIds"] as const;

const systemFieldsToExcludeFromValidation = [
  "id",
  "uid",
  "txIds",
  "$ref",
  "type",
  "key",
  "fields_attrs",
] as const;

export type ChangesetValidationError = {
  fieldKey: string;
  message: string;
};

const collectMandatoryFields = <N extends NamespaceEditable>(
  schema: EntityNsSchema[N],
  typeKey: EntityNsType[N],
  mandatorySet: Set<FieldKey>,
  visited = new Set<EntityNsType[N]>(),
): void => {
  if (visited.has(typeKey)) return;
  visited.add(typeKey);

  const typeDef = (schema.types as any)[typeKey];
  if (!typeDef) return;

  if (typeDef.extends) {
    collectMandatoryFields(schema, typeDef.extends, mandatorySet, visited);
  }

  if (typeDef.fields_attrs) {
    for (const [fieldKey, attrs] of Object.entries(
      typeDef.fields_attrs as FieldAttrDefs,
    )) {
      if (attrs.required) mandatorySet.add(fieldKey);
    }
  }
};

const getMandatoryFields = <N extends NamespaceEditable>(
  schema: EntityNsSchema[N],
  typeKey: EntityNsType[N],
): FieldKey[] => {
  const mandatorySet = new Set<FieldKey>();
  collectMandatoryFields(schema, typeKey, mandatorySet);
  return Array.from(mandatorySet);
};

const getFieldAttrs = <N extends NamespaceEditable>(
  schema: EntityNsSchema[N],
  typeKey: EntityNsType[N],
): Map<FieldKey, FieldAttrDefs[FieldKey]> => {
  const attrsMap = new Map<FieldKey, FieldAttrDefs[FieldKey]>();
  const visited = new Set<EntityNsType[N]>();

  let currentTypeKey: EntityNsType[N] | undefined = typeKey;
  while (currentTypeKey && !visited.has(currentTypeKey)) {
    visited.add(currentTypeKey);

    const typeDef: any = (schema.types as any)[currentTypeKey];
    if (!typeDef) break;

    currentTypeKey = typeDef.extends;
    if (!typeDef.fields_attrs) continue;

    for (const [fieldKey, attrs] of Object.entries(
      typeDef.fields_attrs as FieldAttrDefs,
    )) {
      if (attrsMap.has(fieldKey)) continue;
      attrsMap.set(fieldKey, attrs);
    }
  }

  return attrsMap;
};

const validateChangesetInput = <N extends NamespaceEditable>(
  input: EntityChangesetInput<N>,
  schema: EntityNsSchema[N],
): ChangesetValidationError[] => {
  const errors: ChangesetValidationError[] = [];

  for (const fieldKey of Object.keys(input)) {
    if (systemFieldsToExcludeFromValidation.includes(fieldKey as any)) {
      continue;
    }
    if (!(fieldKey in schema.fields)) {
      errors.push({
        fieldKey,
        message: `field "${fieldKey}" is not defined in schema`,
      });
      continue;
    }

    const fieldDef = (schema.fields as any)[fieldKey];
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

    if (isListMutationArray(value)) {
      for (const mutation of value) {
        const [kind, mutationValue] = mutation;
        const singleValueFieldDef = { ...fieldDef, allowMultiple: false };
        const validationResult = validateDataType(
          singleValueFieldDef,
          mutationValue,
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

    if (isListMutation(value)) {
      const [kind, mutationValue] = value;
      const singleValueFieldDef = { ...fieldDef, allowMultiple: false };
      const validationResult = validateDataType(
        singleValueFieldDef,
        mutationValue,
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

    const validationResult = validateDataType(fieldDef, value);

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

  const mandatoryFields = getMandatoryFields(schema, typeKey);
  const fieldAttrs = getFieldAttrs(schema, typeKey);

  for (const fieldKey of mandatoryFields) {
    const attrs = fieldAttrs.get(fieldKey);
    const hasValueConstraint = attrs?.value !== undefined;
    if (
      !hasValueConstraint &&
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
  schema: EntityNsSchema[N],
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
      errorToObject,
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
    assertEqual(idChange.op, "set", "changeset.id.op");

    if (idChange.op === "set") {
      if (idChange.previous === undefined) {
        assertDefined(changeset.type, "changeset.type");
        const patch = applyChangesetModel(emptyFieldset, changeset);
        return await createEntity(tx, namespace, {
          ...patch,
          [resolveEntityRefType(entityRef)]: entityRef,
        });
      }
      if (idChange.value === undefined) {
        return await deleteEntity(tx, namespace, entityRef);
      }
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
  const newFields: Record<string, NodeFieldDefinition> = {};
  const newTypes: Record<string, NodeTypeDefinition> = {};

  for (const changeset of Object.values(configurationsChangeset)) {
    const idChange = changeset.id ? normalizeValueChange(changeset.id) : null;
    if (
      idChange?.op === "set" &&
      idChange.previous === undefined &&
      idChange.value !== undefined
    ) {
      const entity = applyChangesetModel(emptyFieldset, changeset);

      if (fieldNodeTypes.includes(entity.type as any)) {
        const field = entity as unknown as NodeFieldDefinition;
        newFields[field.key] = field;
      } else if (entity.type === typeConfigType) {
        const type = entity as unknown as NodeTypeDefinition;
        newTypes[type.key] = type;
      }
    }
  }

  return {
    fields: { ...baseSchema.fields, ...newFields },
    types: { ...baseSchema.types, ...newTypes },
  };
};

export const processChangesetInput = async <N extends NamespaceEditable>(
  tx: DbTransaction,
  namespace: N,
  input: ChangesetsInput<N>,
  schema: EntityNsSchema[N],
  lastEntityId: EntityId,
): ResultAsync<EntitiesChangeset<N>> => {
  let lastId = lastEntityId;
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

    const validationErrors = validateChangesetInput(input, schema);
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
      for (const key of keys) {
        const currentValue = currentValues[key];
        const inputValue = input[key];
        if (isListMutationArray(inputValue)) {
          changeset[key] = { op: "seq", mutations: inputValue };
        } else if (isListMutation(inputValue)) {
          changeset[key] = { op: "seq", mutations: [inputValue] };
        } else {
          changeset[key] = {
            op: "set",
            value: inputValue,
            previous: currentValue,
          };
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

      const typeKey = input.type as EntityNsType[N];
      const fieldAttrs = getFieldAttrs(schema, typeKey);
      const fieldsWithValues: Record<string, any> = {};
      for (const [fieldKey, attrs] of fieldAttrs.entries()) {
        if (attrs.value !== undefined && !(fieldKey in input)) {
          fieldsWithValues[fieldKey] = attrs.value;
        }
      }

      const entityData = {
        id: newEntityId,
        ...input,
        ...fieldsWithValues,
        uid: (input["uid"] ?? createUid()) as EntityUid,
      };
      const keys = Object.keys(entityData) as FieldKey[];
      for (const key of keys) {
        changeset[key] = (entityData as any)[key];
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
    return err(
      createError(
        "changeset-input-process-failed",
        "failed creating changeset",
        { errors: flattenedErrors },
      ),
    );
  }

  return ok(
    Object.fromEntries(
      changesetResults.map((it) => throwIfError(it)),
    ) as EntitiesChangeset<N>,
  );
};
