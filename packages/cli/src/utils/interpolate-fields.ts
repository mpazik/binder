import { fail, isErr, ok, type Result } from "@binder/utils";
import {
  type AncestralFieldsetChain,
  type AncestralFieldValueProvider,
  type EntitySchema,
  type Fieldset,
  type FieldsetNested,
  type FieldValue,
  type FieldValueProvider,
  getNestedValue,
  type NestedFieldValueProvider,
  parseFieldPath,
  stringifyFieldValue,
} from "@binder/db";

export type StringifyProvider = (placeholder: string) => Result<string>;

export const interpolatePlain = (
  template: string,
  provider: StringifyProvider,
): Result<string> => {
  let result = "";
  let i = 0;

  while (i < template.length) {
    const char = template[i]!;

    if (char === "\\") {
      const nextChar = template[i + 1];
      if (nextChar === "{" || nextChar === "}") {
        result += nextChar;
        i += 2;
        continue;
      }
      result += char;
      i++;
      continue;
    }

    if (char === "{") {
      const closeIndex = template.indexOf("}", i + 1);
      if (closeIndex === -1) {
        return fail("unclosed-bracket", "Unclosed bracket in template", {
          position: i,
        });
      }

      const placeholder = template.slice(i + 1, closeIndex);

      if (!/^[\w.-]+$/.test(placeholder)) {
        result += char;
        i++;
        continue;
      }

      const valueResult = provider(placeholder);
      if (isErr(valueResult)) return valueResult;
      result += valueResult.data;
      i = closeIndex + 1;
      continue;
    }

    result += char;
    i++;
  }

  return ok(result);
};

export const interpolateFields = (
  schema: EntitySchema,
  template: string,
  provider: Fieldset | FieldValueProvider,
): Result<string> => {
  const getFieldValue =
    typeof provider === "function"
      ? provider
      : (fieldName: string) => provider[fieldName];

  return interpolatePlain(template, (fieldName) => {
    const fieldDef = schema.fields[fieldName];
    if (!fieldDef)
      return fail(
        "field-not-found",
        `Field "${fieldName}" not found in schema`,
      );
    return ok(stringifyFieldValue(getFieldValue(fieldName), fieldDef));
  });
};

export const interpolateNestedFields = (
  schema: EntitySchema,
  template: string,
  provider: FieldsetNested | NestedFieldValueProvider,
): Result<string> => {
  const getFieldValue: NestedFieldValueProvider =
    typeof provider === "function"
      ? provider
      : (path) => getNestedValue(provider, path) ?? null;

  return interpolatePlain(template, (placeholder) => {
    const path = parseFieldPath(placeholder);
    const fieldDef = schema.fields[path[0]!];
    if (!fieldDef)
      return fail("field-not-found", `Field "${path[0]}" not found in schema`);
    return ok(stringifyFieldValue(getFieldValue(path), fieldDef));
  });
};

export const parseAncestralPlaceholder = (
  placeholder: string,
): {
  fieldName: string;
  depth: number;
} => {
  const match = placeholder.match(/^parent(\d*)\.(.+)$/);
  if (!match) return { fieldName: placeholder, depth: 0 };

  const [, indexStr, fieldName] = match;
  const depth = indexStr === "" ? 1 : parseInt(indexStr, 10);

  return { fieldName: fieldName!, depth };
};

const stringifySimpleValue = (value: FieldValue | undefined): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return value.map(stringifySimpleValue).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

export const interpolateAncestralFields = (
  _schema: EntitySchema,
  template: string,
  provider: AncestralFieldsetChain | AncestralFieldValueProvider,
): Result<string> => {
  const getFieldValue: AncestralFieldValueProvider =
    typeof provider === "function"
      ? provider
      : (fieldName, depth) => provider[depth]?.[fieldName];

  return interpolatePlain(template, (placeholder) => {
    const { fieldName, depth } = parseAncestralPlaceholder(placeholder);
    return ok(stringifySimpleValue(getFieldValue(fieldName, depth)));
  });
};

export const extractFieldNames = (template: string): string[] => {
  const fieldNames: string[] = [];
  let i = 0;

  while (i < template.length) {
    const char = template[i]!;

    if (char === "\\") {
      const nextChar = template[i + 1];
      if (nextChar === "{" || nextChar === "}") {
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    if (char === "{") {
      const closeIndex = template.indexOf("}", i + 1);
      if (closeIndex === -1) {
        break;
      }

      const fieldName = template.slice(i + 1, closeIndex);

      if (/^[\w.-]+$/.test(fieldName)) {
        fieldNames.push(fieldName);
      }

      i = closeIndex + 1;
      continue;
    }

    i++;
  }

  return fieldNames;
};

export const extractFieldValues = (
  template: string,
  data: string,
): Result<Fieldset> => {
  const fieldset: Fieldset = {};
  let templateIndex = 0;
  let dataIndex = 0;

  while (templateIndex < template.length) {
    const char = template[templateIndex]!;

    if (char === "\\") {
      const nextChar = template[templateIndex + 1];
      if (nextChar === "{" || nextChar === "}") {
        if (data[dataIndex] !== nextChar) {
          return fail(
            "path_template_mismatch",
            "Path does not match the template",
            {
              template,
              data,
              position: dataIndex,
            },
          );
        }
        templateIndex += 2;
        dataIndex++;
        continue;
      }
      if (data[dataIndex] !== char) {
        return fail(
          "path_template_mismatch",
          "Path does not match the template",
          {
            template,
            data,
            position: dataIndex,
          },
        );
      }
      templateIndex++;
      dataIndex++;
      continue;
    }

    if (char === "{") {
      const closeIndex = template.indexOf("}", templateIndex + 1);
      if (closeIndex === -1) {
        return fail("unclosed-bracket", "Unclosed bracket in template", {
          position: templateIndex,
        });
      }

      const fieldName = template.slice(templateIndex + 1, closeIndex);

      if (!/^[\w.-]+$/.test(fieldName)) {
        if (data[dataIndex] !== char) {
          return fail(
            "path_template_mismatch",
            "Path does not match the template",
            { template, data, position: dataIndex },
          );
        }
        templateIndex++;
        dataIndex++;
        continue;
      }

      const nextLiteralIndex = closeIndex + 1;
      const nextLiteral =
        nextLiteralIndex < template.length ? template[nextLiteralIndex] : null;

      let value = "";
      if (nextLiteral) {
        const literalIndex = data.indexOf(nextLiteral, dataIndex);
        if (literalIndex === -1) {
          return fail(
            "path_template_mismatch",
            "Path does not match the template",
            { template, data, position: dataIndex },
          );
        }
        value = data.slice(dataIndex, literalIndex);
        dataIndex = literalIndex;
      } else {
        value = data.slice(dataIndex);
        dataIndex = data.length;
      }

      fieldset[fieldName] = value;
      templateIndex = closeIndex + 1;
      continue;
    }

    if (data[dataIndex] !== char) {
      return fail(
        "path_template_mismatch",
        "Path does not match the template",
        {
          template,
          data,
          position: dataIndex,
        },
      );
    }

    templateIndex++;
    dataIndex++;
  }

  if (dataIndex !== data.length) {
    return fail("path_template_mismatch", "Path does not match the template", {
      template,
      data,
      extraData: data.slice(dataIndex),
    });
  }

  return ok(fieldset);
};
