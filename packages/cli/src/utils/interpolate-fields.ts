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
