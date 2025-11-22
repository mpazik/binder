import type {
  ValidationContext,
  ValidationError,
  Validator,
} from "../types.ts";
import type { ParsedMarkdown } from "../../document/markdown.ts";

export const createMarkdownValidator = (): Validator<ParsedMarkdown> => ({
  validate: (_content, _context) => {
    const errors: ValidationError[] = [];
    return errors;
  },
});
