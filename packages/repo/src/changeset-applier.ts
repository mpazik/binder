import {
  assert,
  assertDefined,
  assertFailed,
  includes,
  isObjectEmpty,
  isErr,
  objEntries,
  objKeys,
  okVoid,
  type ResultAsync,
} from "@binder/utils";
import {
  applyChangeset as applyChangesetModel,
  type EntitiesChangeset,
  emptyFieldset,
  type EntityNsRef,
  type EntityType,
  type FieldChangeset,
  type FieldKey,
  fieldTypes,
  isClearChange,
  isSetChange,
  type NamespaceEditable,
  normalizeValueChange,
  type RecordFieldDef,
  type RecordSchema,
  resolveEntityRefType,
  type TypeDef,
  typeSystemType,
} from "./model";
import type { DbTransaction } from "./db.ts";
import {
  createEntity,
  deleteEntity,
  fetchEntityFieldset,
  updateEntity,
} from "./entity-store.ts";

export const applyChangeset = async <N extends NamespaceEditable>(
  tx: DbTransaction,
  namespace: N,
  entityRef: EntityNsRef[N],
  changeset: FieldChangeset,
): ResultAsync<void> => {
  if (isObjectEmpty(changeset)) return okVoid;

  if ("id" in changeset) {
    const idChange = normalizeValueChange(changeset.id);
    assert(
      isSetChange(idChange) || isClearChange(idChange),
      "changeset.id must be set or clear",
    );

    if (isSetChange(idChange) && idChange.length === 2) {
      assertDefined(changeset.type, "changeset.type");
      const patch = applyChangesetModel(emptyFieldset, changeset);
      return createEntity(tx, namespace, {
        ...patch,
        [resolveEntityRefType(entityRef)]: entityRef,
      });
    }
    if (isClearChange(idChange)) {
      return deleteEntity(tx, namespace, entityRef);
    }
    assertFailed("id can only be set or cleared");
  } else {
    const keys = objKeys(changeset);
    const selectResult = await fetchEntityFieldset(
      tx,
      namespace,
      entityRef,
      keys,
    );
    if (isErr(selectResult)) return selectResult;

    const currentValues = selectResult.data;
    const patch = applyChangesetModel(currentValues, changeset);
    return updateEntity(tx, namespace, entityRef, patch);
  }
};

export const applyConfigChangesetToSchema = (
  baseSchema: RecordSchema,
  configsChangeset: EntitiesChangeset<"config">,
): RecordSchema => {
  const newFields: RecordSchema["fields"] = { ...baseSchema.fields };
  const newTypes: RecordSchema["types"] = { ...baseSchema.types };

  for (const [configKey, changeset] of objEntries(configsChangeset)) {
    const idChange = changeset.id ? normalizeValueChange(changeset.id) : null;

    if (idChange && isClearChange(idChange)) {
      delete newFields[configKey as FieldKey];
      delete newTypes[configKey as EntityType];
    } else if (idChange && isSetChange(idChange) && idChange.length === 2) {
      const entity = applyChangesetModel(emptyFieldset, changeset);

      if (includes(fieldTypes, entity.type)) {
        const field = entity as RecordFieldDef;
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
        newFields[configKey as FieldKey] = updated as RecordFieldDef;
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
