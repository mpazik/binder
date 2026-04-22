import {
  getTypeFieldKey,
  type EntityKey,
  type EntitySchema,
  type EntityType,
} from "@binder/repo";
import { filterObjectValues } from "@binder/utils";

export type SchemaFilter = {
  typeKeys?: EntityType[];
  fieldKeys?: EntityKey[];
};

const collectTypeFields = (types: EntitySchema["types"]): Set<EntityKey> => {
  const result = new Set<EntityKey>();

  for (const typeDef of Object.values(types)) {
    for (const fieldRef of typeDef.fields) {
      result.add(getTypeFieldKey(fieldRef) as EntityKey);
    }
  }

  return result;
};

export const filterSchema = (
  schema: EntitySchema,
  filters: SchemaFilter,
): EntitySchema => {
  const allowedTypes = new Set(
    (filters.typeKeys ?? (Object.keys(schema.types) as EntityType[])).filter(
      (typeKey) => schema.types[typeKey],
    ),
  );

  const allowedFields = filters.fieldKeys
    ? new Set(filters.fieldKeys.filter((fieldKey) => schema.fields[fieldKey]))
    : undefined;

  const filteredTypes = filterObjectValues(schema.types, (typeDef, typeKey) => {
    if (!allowedTypes.has(typeKey as EntityType)) return false;

    if (!allowedFields) return true;

    return typeDef.fields.some((fieldRef) =>
      allowedFields.has(getTypeFieldKey(fieldRef) as EntityKey),
    );
  });

  const typesWithFilteredFields = Object.fromEntries(
    Object.entries(filteredTypes).map(([typeKey, typeDef]) => {
      if (!allowedFields) return [typeKey, typeDef];

      return [
        typeKey,
        {
          ...typeDef,
          fields: typeDef.fields.filter((fieldRef) =>
            allowedFields.has(getTypeFieldKey(fieldRef) as EntityKey),
          ),
        },
      ];
    }),
  ) as EntitySchema["types"];

  const allFields = collectTypeFields(typesWithFilteredFields);

  return {
    fields: filterObjectValues(schema.fields, (_, key) =>
      allFields.has(key as EntityKey),
    ),
    types: typesWithFilteredFields,
  };
};

export const filterSchemaByTypes = (
  schema: EntitySchema,
  typeKeys: EntityType[],
): EntitySchema => filterSchema(schema, { typeKeys });
