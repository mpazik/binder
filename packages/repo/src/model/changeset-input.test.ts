import { describe, it, expect } from "bun:test";
import {
  normalizeInput,
  normalizeListMutationInput,
  type EntityChangesetInput,
} from "./changeset-input.ts";
import { mockRecordSchema } from "./schema.mock.ts";
import {
  mockChaptersFieldKey,
  mockMembersFieldKey,
  mockTaskTypeKey,
  mockTeamTypeKey,
} from "./config.mock.ts";
import { mockUserUid } from "./record.mock.ts";
import { tagsFieldKey } from "./schema.ts";

describe("changeset-input", () => {
  describe("normalizeInput", () => {
    describe("allowMultiple plaintext identifier field", () => {
      const check = (tags: string | string[], expected: string[]) => {
        const input: EntityChangesetInput<"record"> = {
          type: mockTaskTypeKey,
          title: "Test Task",
          [tagsFieldKey]: tags,
        };
        expect(normalizeInput(input, mockRecordSchema)).toMatchObject({
          [tagsFieldKey]: expected,
        });
      };

      it("normalizes single value to array", () =>
        check("single-tag", ["single-tag"]));

      it("normalizes comma-separated string to array", () =>
        check("tag1, tag2, tag3", ["tag1", "tag2", "tag3"]));

      it("preserves array values", () => check(["a", "b"], ["a", "b"]));

      it("filters empty items when splitting by delimiter", () =>
        check("a,,b", ["a", "b"]));
    });

    it("does not split non-allowMultiple fields", () => {
      const input: EntityChangesetInput<"record"> = {
        type: mockTaskTypeKey,
        title: "Title, with comma",
      };
      expect(normalizeInput(input, mockRecordSchema)).toMatchObject({
        title: "Title, with comma",
      });
    });

    it("normalizes ObjTuple to tuple in allowMultiple relation field", () => {
      const input: EntityChangesetInput<"record"> = {
        type: mockTeamTypeKey,
        [mockMembersFieldKey]: [{ [mockUserUid]: { role: "admin" } }],
      };
      expect(normalizeInput(input, mockRecordSchema)).toMatchObject({
        [mockMembersFieldKey]: [[mockUserUid, { role: "admin" }]],
      });
    });

    it("splits string by delimiter for allowMultiple richtext document fields", () => {
      const multiDocContent = `# First Document

Content of first doc.

---

# Second Document

Content of second doc.`;

      const input: EntityChangesetInput<"record"> = {
        type: mockTaskTypeKey,
        title: "Test Task",
        [mockChaptersFieldKey]: multiDocContent as unknown as string[],
      };
      expect(normalizeInput(input, mockRecordSchema)).toMatchObject({
        [mockChaptersFieldKey]: [
          "# First Document\n\nContent of first doc.",
          "# Second Document\n\nContent of second doc.",
        ],
      });
    });

    it("keeps single document without delimiter as single-element array", () => {
      const singleDocContent = `# Single Document

Content without any delimiter.`;

      const input: EntityChangesetInput<"record"> = {
        type: mockTaskTypeKey,
        title: "Test Task",
        [mockChaptersFieldKey]: singleDocContent as unknown as string[],
      };
      expect(normalizeInput(input, mockRecordSchema)).toMatchObject({
        [mockChaptersFieldKey]: [singleDocContent],
      });
    });
  });

  describe("normalizeListMutationInput", () => {
    const check = (
      input: Parameters<typeof normalizeListMutationInput>[0],
      expected: ReturnType<typeof normalizeListMutationInput>,
    ) => {
      expect(normalizeListMutationInput(input)).toEqual(expected);
    };

    it("produces 2-element remove when position is absent", () =>
      check(["remove", "urgent"], ["remove", "urgent"]));

    it("produces 3-element remove when position is provided", () =>
      check(["remove", "urgent", 0], ["remove", "urgent", 0]));

    it("produces 2-element insert when position is absent", () =>
      check(["insert", "tag"], ["insert", "tag"]));

    it("produces 3-element insert when position is provided", () =>
      check(["insert", "tag", 1], ["insert", "tag", 1]));

    it("survives JSON round-trip without gaining null position", () => {
      const roundTripped = JSON.parse(
        JSON.stringify(normalizeListMutationInput(["remove", "urgent"])),
      );
      expect(roundTripped).toEqual(["remove", "urgent"]);
    });
  });
});
