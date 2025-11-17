import { createError, err, ok, type Result } from "@binder/utils";
import { type Fieldset, formatValue } from "@binder/db";

export const interpolateFields = (
  template: string,
  fieldset: Fieldset | ((key: string) => string),
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
        return err(
          createError("unclosed-bracket", "Unclosed bracket in template", {
            position: i,
          }),
        );
      }

      const fieldName = template.slice(i + 1, closeIndex);

      if (!/^[\w.-]+$/.test(fieldName)) {
        result += char;
        i++;
        continue;
      }

      const value =
        typeof fieldset === "function"
          ? fieldset(fieldName)
          : formatValue(fieldset[fieldName]);
      result += value;
      i = closeIndex + 1;
      continue;
    }

    result += char;
    i++;
  }

  return ok(result);
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
          return err(
            createError(
              "path_template_mismatch",
              "Path does not match the template",
              { template, data, position: dataIndex },
            ),
          );
        }
        templateIndex += 2;
        dataIndex++;
        continue;
      }
      if (data[dataIndex] !== char) {
        return err(
          createError(
            "path_template_mismatch",
            "Path does not match the template",
            { template, data, position: dataIndex },
          ),
        );
      }
      templateIndex++;
      dataIndex++;
      continue;
    }

    if (char === "{") {
      const closeIndex = template.indexOf("}", templateIndex + 1);
      if (closeIndex === -1) {
        return err(
          createError("unclosed-bracket", "Unclosed bracket in template", {
            position: templateIndex,
          }),
        );
      }

      const fieldName = template.slice(templateIndex + 1, closeIndex);

      if (!/^[\w.-]+$/.test(fieldName)) {
        if (data[dataIndex] !== char) {
          return err(
            createError(
              "path_template_mismatch",
              "Path does not match the template",
              { template, data, position: dataIndex },
            ),
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
          return err(
            createError(
              "path_template_mismatch",
              "Path does not match the template",
              { template, data, position: dataIndex },
            ),
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
      return err(
        createError(
          "path_template_mismatch",
          "Path does not match the template",
          { template, data, position: dataIndex },
        ),
      );
    }

    templateIndex++;
    dataIndex++;
  }

  if (dataIndex !== data.length) {
    return err(
      createError(
        "path_template_mismatch",
        "Path does not match the template",
        { template, data, extraData: data.slice(dataIndex) },
      ),
    );
  }

  return ok(fieldset);
};
