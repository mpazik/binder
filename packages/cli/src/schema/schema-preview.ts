import {
  getTypeFieldAttrs,
  getTypeFieldKey,
  type EntitySchema,
  type FieldAttrDef,
  type FieldDef,
} from "@binder/db";
import { formatWhenCondition } from "../utils/query.ts";

const formatFieldType = (field: FieldDef): string => {
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

export const renderSchemaPreview = (schema: EntitySchema): string => {
  let result = "FIELDS:\n";

  for (const [fieldKey, fieldDef] of Object.entries(schema.fields)) {
    const typeInfo = formatFieldType(fieldDef);
    const whenInfo = fieldDef.when
      ? ` {when: ${formatWhenCondition(fieldDef.when)}}`
      : "";
    const description = fieldDef.description
      ? ` - ${fieldDef.description}`
      : "";
    result += `• ${fieldKey}: ${typeInfo}${whenInfo}${description}\n`;
  }

  result += "\nTYPES:\n";

  for (const [typeKey, typeDef] of Object.entries(schema.types)) {
    const description = typeDef.description ? ` - ${typeDef.description}` : "";

    const fieldRefs = typeDef.fields || [];

    const countConstraints = fieldRefs.reduce((count, ref) => {
      const attrs = getTypeFieldAttrs(ref);
      if (!attrs) return count;
      return count + Object.keys(attrs).length;
    }, 0);

    const totalComplexity = fieldRefs.length + countConstraints;
    const useMultiLine = totalComplexity > 4;

    if (fieldRefs.length === 0) {
      result += `• ${typeKey}${description}\n`;
    } else if (useMultiLine) {
      const formattedFields = fieldRefs
        .map((ref) => {
          const attrs = formatFieldAttributes(getTypeFieldAttrs(ref));
          return `    ${getTypeFieldKey(ref)}${attrs}`;
        })
        .join(",\n");
      result += `• ${typeKey}${description} [\n${formattedFields}\n  ]\n`;
    } else {
      const formattedFields = fieldRefs
        .map((ref) => {
          const attrs = formatFieldAttributes(getTypeFieldAttrs(ref));
          return `${getTypeFieldKey(ref)}${attrs}`;
        })
        .join(", ");
      result += `• ${typeKey}${description} [${formattedFields}]\n`;
    }
  }

  return result;
};
