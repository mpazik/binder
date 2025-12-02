import {
  getTypeFieldKey,
  type EntityKey,
  type EntitySchema,
  type EntityType,
} from "@binder/db";
import { filterObjectValues } from "@binder/utils";

const collectTypeFields = (
  schema: EntitySchema,
  typeKeys: Set<EntityType>,
): Set<EntityKey> => {
  const result = new Set<EntityKey>();

  for (const typeKey of typeKeys) {
    const typeDef = schema.types[typeKey];
    if (!typeDef) continue;

    for (const fieldRef of typeDef.fields) {
      result.add(getTypeFieldKey(fieldRef) as EntityKey);
    }
  }

  return result;
};

export const filterSchemaByTypes = (
  schema: EntitySchema,
  typeKeys: EntityType[],
): EntitySchema => {
  const validTypes = new Set(
    typeKeys.filter((typeKey) => schema.types[typeKey]),
  );
  const allFields = collectTypeFields(schema, validTypes);

  return {
    fields: filterObjectValues(schema.fields, (_, key) =>
      allFields.has(key as EntityKey),
    ),
    types: filterObjectValues(schema.types, (_, key) =>
      validTypes.has(key as EntityType),
    ),
  };
};
