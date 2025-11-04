import type { NodeFieldKey, NodeSchema, NodeType } from "@binder/db";
import { filterObjectValues } from "@binder/utils";

const collectExtendedTypes = (
  schema: NodeSchema,
  typeKeys: NodeType[],
): Set<NodeType> => {
  const result = new Set<NodeType>();

  const addTypeAndParents = (typeKey: NodeType) => {
    if (result.has(typeKey)) return;
    result.add(typeKey);

    const typeDef = schema.types[typeKey];
    if (!typeDef) return;

    const extendsType = typeDef.extends;
    if (extendsType) {
      addTypeAndParents(extendsType as NodeType);
    }
  };

  for (const typeKey of typeKeys) {
    addTypeAndParents(typeKey);
  }

  return result;
};

const collectTypeFields = (
  schema: NodeSchema,
  typeKeys: Set<NodeType>,
): Set<NodeFieldKey> => {
  const result = new Set<NodeFieldKey>();

  for (const typeKey of typeKeys) {
    const typeDef = schema.types[typeKey];
    if (!typeDef) continue;

    const fields = (typeDef.fields as NodeFieldKey[]) ?? [];
    for (const field of fields) {
      result.add(field);
    }
  }

  return result;
};

export const filterSchemaByTypes = (
  schema: NodeSchema,
  typeKeys: NodeType[],
): NodeSchema => {
  const allTypes = collectExtendedTypes(schema, typeKeys);
  const allFields = collectTypeFields(schema, allTypes);

  return {
    fields: filterObjectValues(schema.fields, (_, key) => allFields.has(key)),
    types: filterObjectValues(schema.types, (_, key) => allTypes.has(key)),
  };
};
