import type { EntityKey, EntitySchema, EntityType } from "@binder/db";
import { filterObjectValues } from "@binder/utils";

const collectExtendedTypes = (
  schema: EntitySchema,
  typeKeys: EntityType[],
): Set<EntityType> => {
  const result = new Set<EntityType>();

  const addTypeAndParents = (typeKey: EntityType) => {
    if (result.has(typeKey)) return;
    result.add(typeKey);

    const typeDef = schema.types[typeKey];
    if (!typeDef) return;

    const extendsType = typeDef.extends;
    if (extendsType) {
      addTypeAndParents(extendsType as EntityType);
    }
  };

  for (const typeKey of typeKeys) {
    addTypeAndParents(typeKey);
  }

  return result;
};

const collectTypeFields = (
  schema: EntitySchema,
  typeKeys: Set<EntityType>,
): Set<EntityKey> => {
  const result = new Set<EntityKey>();

  for (const typeKey of typeKeys) {
    const typeDef = schema.types[typeKey];
    if (!typeDef) continue;

    const fields = (typeDef.fields as EntityKey[]) ?? [];
    for (const field of fields) {
      result.add(field);
    }
  }

  return result;
};

export const filterSchemaByTypes = (
  schema: EntitySchema,
  typeKeys: EntityType[],
): EntitySchema => {
  const allTypes = collectExtendedTypes(schema, typeKeys);
  const allFields = collectTypeFields(schema, allTypes);

  return {
    fields: filterObjectValues(schema.fields, (_, key) =>
      allFields.has(key as EntityKey),
    ),
    types: filterObjectValues(schema.types, (_, key) =>
      allTypes.has(key as EntityKey),
    ),
  };
};
