import type { FieldAttrDef, NodeFieldDefinition, NodeSchema } from "@binder/db";

const formatFieldType = (field: NodeFieldDefinition): string => {
  const { dataType, allowMultiple, range, options } = field;

  if (dataType === "relation") {
    if (!range || range.length === 0)
      return allowMultiple ? "Entity[]" : "Entity";

    const targetTypes = range.join("|");
    if (allowMultiple) {
      return range.length > 1 ? `(${targetTypes})[]` : `${targetTypes}[]`;
    }
    return targetTypes;
  }

  if (dataType === "option") {
    if (options && options.length > 0) {
      const optionValues = options.map((opt) => opt.key).join("|");
      if (allowMultiple) {
        return options.length > 1 ? `(${optionValues})[]` : `${optionValues}[]`;
      }
      return optionValues;
    }
    // Show option without defined options
    return allowMultiple ? "option[]" : "option";
  }

  return allowMultiple ? `${dataType}[]` : dataType;
};

const formatFieldAttributes = (attrs?: FieldAttrDef): string => {
  if (!attrs) return "";

  const parts: string[] = [];

  if (attrs.required) parts.push("required");

  if (attrs.default !== undefined) {
    const defaultValue =
      typeof attrs.default === "string" && attrs.default.includes(" ")
        ? `"${attrs.default}"`
        : String(attrs.default);
    parts.push(`default: ${defaultValue}`);
  }

  if (attrs.description) parts.push(`description: "${attrs.description}"`);
  if (attrs.min !== undefined) parts.push(`min: ${attrs.min}`);

  if (attrs.only && attrs.only.length > 0)
    parts.push(`only: ${attrs.only.join("|")}`);
  if (attrs.exclude && attrs.exclude.length > 0)
    parts.push(`exclude: ${attrs.exclude.join("|")}`);

  return parts.length > 0 ? `{${parts.join(", ")}}` : "";
};

export const renderSchemaPreview = (schema: NodeSchema): string => {
  let result = "FIELDS:\n";

  for (const [fieldKey, fieldDef] of Object.entries(schema.fields)) {
    const typeInfo = formatFieldType(fieldDef);
    const description = fieldDef.description
      ? ` - ${fieldDef.description}`
      : "";
    result += `• ${fieldKey}: ${typeInfo}${description}\n`;
  }

  result += "\nTYPES:\n";

  for (const [typeKey, typeDef] of Object.entries(schema.types)) {
    const description = typeDef.description ? ` - ${typeDef.description}` : "";
    const extendsClause =
      typeDef.extends && typeDef.extends.length > 0
        ? ` <${typeDef.extends}>`
        : "";

    const fields = typeDef.fields || [];
    const fieldAttrs = typeDef.fields_attrs || {};

    const countConstraints = fields.reduce((count, f) => {
      const attrs = fieldAttrs[f];
      if (!attrs) return count;
      return count + Object.keys(attrs).length;
    }, 0);

    const totalComplexity = fields.length + countConstraints;
    const useMultiLine = totalComplexity > 4;

    if (fields.length === 0) {
      result += `• ${typeKey}${extendsClause}${description}\n`;
    } else if (useMultiLine) {
      const formattedFields = fields
        .map((f) => {
          const attrs = formatFieldAttributes(fieldAttrs[f]);
          return `    ${f}${attrs}`;
        })
        .join(",\n");
      result += `• ${typeKey}${extendsClause}${description} [\n${formattedFields}\n  ]\n`;
    } else {
      const formattedFields = fields
        .map((f) => {
          const attrs = formatFieldAttributes(fieldAttrs[f]);
          return `${f}${attrs}`;
        })
        .join(", ");
      result += `• ${typeKey}${extendsClause}${description} [${formattedFields}]\n`;
    }
  }

  return result;
};
