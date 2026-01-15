import { describe, it, expect } from "bun:test";
import {
  normalizeInput,
  type EntityChangesetInput,
} from "./changeset-input.ts";
import { mockNodeSchema } from "./schema.mock.ts";
import { mockChaptersFieldKey, mockTaskTypeKey } from "./config.mock.ts";

describe("changeset-input", () => {
  describe("normalizeInput", () => {
    it("splits string by delimiter for allowMultiple richtext document fields", () => {
      // Document format uses --- as delimiter
      const multiDocContent = `# First Document

Content of first doc.

---

# Second Document

Content of second doc.`;

      const input: EntityChangesetInput<"node"> = {
        type: mockTaskTypeKey,
        title: "Test Task",
        [mockChaptersFieldKey]: multiDocContent as unknown as string[],
      };

      const result = normalizeInput(input, mockNodeSchema);

      expect(result).toMatchObject({
        [mockChaptersFieldKey]: [
          "# First Document\n\nContent of first doc.",
          "# Second Document\n\nContent of second doc.",
        ],
      });
    });

    it("keeps single document without delimiter as single-element array", () => {
      const singleDocContent = `# Single Document

Content without any delimiter.`;

      const input: EntityChangesetInput<"node"> = {
        type: mockTaskTypeKey,
        title: "Test Task",
        [mockChaptersFieldKey]: singleDocContent as unknown as string[],
      };

      const result = normalizeInput(input, mockNodeSchema);

      expect(result).toMatchObject({
        [mockChaptersFieldKey]: [singleDocContent],
      });
    });
  });
});
