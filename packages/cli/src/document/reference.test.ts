import { beforeEach, describe, expect, it } from "bun:test";
import { throwIfError } from "@binder/utils";
import "@binder/utils/tests";
import { type FieldsetNested, type KnowledgeGraph } from "@binder/db";
import {
  mockRecordSchema,
  mockProjectField,
  mockProjectKey,
  mockProjectRecord,
  mockProjectUid,
  mockTask2Record,
  mockTask3Record,
  mockTasksField,
  mockTransactionInitInput,
} from "@binder/db/mocks";
import { createMockRuntimeContextWithDb } from "../runtime.mock.ts";
import type { RuntimeContextWithDb } from "../runtime.ts";
import { mockDocumentTransactionInput } from "./document.mock.ts";
import {
  formatReferences,
  formatReferencesList,
  normalizeReferences,
  normalizeReferencesList,
} from "./reference.ts";

describe("reference", () => {
  let ctx: RuntimeContextWithDb;
  let kg: KnowledgeGraph;

  beforeEach(async () => {
    ctx = await createMockRuntimeContextWithDb();
    kg = ctx.kg;
    throwIfError(await kg.update(mockTransactionInitInput));
    throwIfError(await kg.update(mockDocumentTransactionInput));
  });

  describe("normalizeReferences", () => {
    const check = async (input: FieldsetNested, expected: FieldsetNested) => {
      const result = throwIfError(
        await normalizeReferences(input, mockRecordSchema, kg),
      );
      expect(result).toEqual(expected);
    };

    it("converts key to uid for relation field", async () => {
      await check(
        { title: "Test Task", [mockProjectField.key]: mockProjectKey },
        { title: "Test Task", [mockProjectField.key]: mockProjectUid },
      );
    });

    it("keeps uid unchanged for relation field", async () => {
      await check(
        { title: "Test Task", [mockProjectField.key]: mockProjectUid },
        { title: "Test Task", [mockProjectField.key]: mockProjectUid },
      );
    });

    it("keeps non-relation fields unchanged", async () => {
      const entity = {
        title: "Test Task",
        status: "todo",
        description: "Some description",
      };
      await check(entity, entity);
    });

    it("handles missing relation value gracefully", async () => {
      await check(
        { title: "Test Task", [mockProjectField.key]: "nonexistent-key" },
        { title: "Test Task", [mockProjectField.key]: "nonexistent-key" },
      );
    });

    it("normalizes nested relation references", async () => {
      await check(
        {
          ...mockProjectRecord,
          [mockTasksField.key]: [
            { ...mockTask2Record, [mockProjectField.key]: mockProjectKey },
          ],
        },
        {
          ...mockProjectRecord,
          [mockTasksField.key]: [
            { ...mockTask2Record, [mockProjectField.key]: mockProjectUid },
          ],
        },
      );
    });
  });

  describe("formatReferences", () => {
    const check = async (input: FieldsetNested, expected: FieldsetNested) => {
      const result = throwIfError(
        await formatReferences(input, mockRecordSchema, kg),
      );
      expect(result).toEqual(expected);
    };

    it("converts uid to key for relation field", async () => {
      await check(
        { title: "Test Task", [mockProjectField.key]: mockProjectUid },
        { title: "Test Task", [mockProjectField.key]: mockProjectKey },
      );
    });

    it("keeps key unchanged for relation field", async () => {
      await check(
        { title: "Test Task", [mockProjectField.key]: mockProjectKey },
        { title: "Test Task", [mockProjectField.key]: mockProjectKey },
      );
    });

    it("formats nested relation references", async () => {
      await check(
        {
          ...mockProjectRecord,
          [mockTasksField.key]: [
            { ...mockTask2Record, [mockProjectField.key]: mockProjectUid },
          ],
        },
        {
          ...mockProjectRecord,
          [mockTasksField.key]: [
            { ...mockTask2Record, [mockProjectField.key]: mockProjectKey },
          ],
        },
      );
    });
  });

  describe("normalizeReferencesList", () => {
    it("normalizes references in multiple entities", async () => {
      const result = throwIfError(
        await normalizeReferencesList(
          [
            { ...mockTask2Record, [mockProjectField.key]: mockProjectKey },
            { ...mockTask3Record, [mockProjectField.key]: mockProjectKey },
          ],
          mockRecordSchema,
          kg,
        ),
      );

      expect(result).toEqual([
        { ...mockTask2Record, [mockProjectField.key]: mockProjectUid },
        { ...mockTask3Record, [mockProjectField.key]: mockProjectUid },
      ]);
    });
  });

  describe("formatReferencesList", () => {
    it("formats references in multiple entities", async () => {
      const result = throwIfError(
        await formatReferencesList(
          [mockTask2Record, mockTask3Record],
          mockRecordSchema,
          kg,
        ),
      );

      expect(result).toEqual([
        { ...mockTask2Record, [mockProjectField.key]: mockProjectKey },
        { ...mockTask3Record, [mockProjectField.key]: mockProjectKey },
      ]);
    });
  });

  describe("tuple to ObjTuple conversion", () => {
    it("converts TypeFieldRef tuple in array to ObjTuple format", async () => {
      const result = throwIfError(
        await formatReferences(
          {
            title: "Test",
            fields: [["title", { required: true }]],
          },
          mockRecordSchema,
          kg,
        ),
      );

      expect(result).toEqual({
        title: "Test",
        fields: [{ title: { required: true } }],
      });
    });
  });
});
