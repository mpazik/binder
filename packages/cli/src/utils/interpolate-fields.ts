import { fail, ok, type Result } from "@binder/utils";
import {
  type AncestralFieldsetChain,
  type AncestralFieldValueProvider,
  type Fieldset,
  type FieldsetNested,
  type FieldValueProvider,
  formatFieldValue,
  getNestedValue,
  type NestedFieldValueProvider,
  parseFieldPath,
} from "@binder/db";

export const interpolateFields = (
  template: string,
  provider: Fieldset | FieldValueProvider,
): Result<string> => {
  const getFieldValue =
    typeof provider === "function"
      ? provider
      : (fieldName: string) => provider[fieldName];

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

      const fieldName = template.slice(i + 1, closeIndex);

      if (!/^[\w.-]+$/.test(fieldName)) {
        result += char;
        i++;
        continue;
      }

      const value = formatFieldValue(getFieldValue(fieldName));
      result += value;
      i = closeIndex + 1;
      continue;
    }

    result += char;
    i++;
  }

  return ok(result);
};

export const interpolateNestedFields = (
  template: string,
  provider: FieldsetNested | NestedFieldValueProvider,
): Result<string> => {
  const getFieldValue: NestedFieldValueProvider =
    typeof provider === "function"
      ? provider
      : (path) => getNestedValue(provider, path) ?? null;

  return interpolateFields(template, (placeholder) => {
    const path = parseFieldPath(placeholder);
    return getFieldValue(path);
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

export const interpolateAncestralFields = (
  template: string,
  provider: AncestralFieldsetChain | AncestralFieldValueProvider,
): Result<string> => {
  const getFieldValue: AncestralFieldValueProvider =
    typeof provider === "function"
      ? provider
      : (fieldName, depth) => provider[depth]?.[fieldName];

  return interpolateFields(template, (placeholder) => {
    const { fieldName, depth } = parseAncestralPlaceholder(placeholder);
    return getFieldValue(fieldName, depth);
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
