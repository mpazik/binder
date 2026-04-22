import {
  getTypeFieldAttrs,
  getTypeFieldKey,
  type EntitySchema,
  type FieldAttrDef,
  type FieldDef,
} from "@binder/repo";
import { serializeFieldValue } from "@binder/repo";
import { formatWhenCondition } from "../utils/query.ts";
import {
  textBold,
  textDim,
  textHighlight,
  textInfo,
  textInfoBold,
} from "../cli/ui.ts";

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

const formatFieldAttributes = (
  attrs?: FieldAttrDef,
  fieldDef?: FieldDef,
): string => {
  if (!attrs) return "";

  const parts: string[] = [];

  if (attrs.required) parts.push("required");

  if (attrs.value !== undefined && fieldDef !== undefined) {
    parts.push(`value: ${serializeFieldValue(attrs.value, fieldDef)}`);
  }

  if (attrs.default !== undefined && fieldDef !== undefined) {
    parts.push(`default: ${serializeFieldValue(attrs.default, fieldDef)}`);
  }

  if (attrs.description) parts.push(`description: "${attrs.description}"`);
  if (attrs.min !== undefined) parts.push(`min: ${attrs.min}`);

  if (attrs.only && attrs.only.length > 0)
    parts.push(`only: ${attrs.only.join("|")}`);
  if (attrs.exclude && attrs.exclude.length > 0)
    parts.push(`exclude: ${attrs.exclude.join("|")}`);

  return parts.length > 0 ? textDim(`{${parts.join(", ")}}`) : "";
};

export const renderSchemaPreview = (schema: EntitySchema): string => {
  let result = textBold("FIELDS:") + "\n";

  for (const [fieldKey, fieldDef] of Object.entries(schema.fields)) {
    const typeInfo = textHighlight(formatFieldType(fieldDef));
    const whenInfo = fieldDef.when
      ? " " + textDim(`{when: ${formatWhenCondition(fieldDef.when)}}`)
      : "";
    const description = fieldDef.description
      ? ` - ${fieldDef.description}`
      : "";
    result += `• ${textInfo(fieldKey)}: ${typeInfo}${whenInfo}${description}\n`;
  }

  result += "\n" + textBold("TYPES:") + "\n";

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
      result += `• ${textInfoBold(typeKey)}${description}\n`;
    } else if (useMultiLine) {
      const formattedFields = fieldRefs
        .map((ref) => {
          const key = getTypeFieldKey(ref);
          const attrs = formatFieldAttributes(
            getTypeFieldAttrs(ref),
            schema.fields[key],
          );
          return `    ${key}${attrs}`;
        })
        .join(",\n");
      result += `• ${textInfoBold(typeKey)}${description} [\n${formattedFields}\n  ]\n`;
    } else {
      const formattedFields = fieldRefs
        .map((ref) => {
          const key = getTypeFieldKey(ref);
          const attrs = formatFieldAttributes(
            getTypeFieldAttrs(ref),
            schema.fields[key],
          );
          return `${key}${attrs}`;
        })
        .join(", ");
      result += `• ${textInfoBold(typeKey)}${description} [${formattedFields}]\n`;
    }
  }

  return result;
};
