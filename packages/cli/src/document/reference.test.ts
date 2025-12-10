import { beforeEach, describe, expect, it } from "bun:test";
import { throwIfError } from "@binder/utils";
import "@binder/utils/tests";
import { type FieldsetNested, type KnowledgeGraph } from "@binder/db";
import {
  mockNodeSchema,
  mockProjectField,
  mockProjectKey,
  mockProjectNode,
  mockProjectUid,
  mockTask2Node,
  mockTask3Node,
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
        await normalizeReferences(input, mockNodeSchema, kg),
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
          ...mockProjectNode,
          [mockTasksField.key]: [
            { ...mockTask2Node, [mockProjectField.key]: mockProjectKey },
          ],
        },
        {
          ...mockProjectNode,
          [mockTasksField.key]: [
            { ...mockTask2Node, [mockProjectField.key]: mockProjectUid },
          ],
        },
      );
    });
  });

  describe("formatReferences", () => {
    const check = async (input: FieldsetNested, expected: FieldsetNested) => {
      const result = throwIfError(
        await formatReferences(input, mockNodeSchema, kg),
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
          ...mockProjectNode,
          [mockTasksField.key]: [
            { ...mockTask2Node, [mockProjectField.key]: mockProjectUid },
          ],
        },
        {
          ...mockProjectNode,
          [mockTasksField.key]: [
            { ...mockTask2Node, [mockProjectField.key]: mockProjectKey },
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
            { ...mockTask2Node, [mockProjectField.key]: mockProjectKey },
            { ...mockTask3Node, [mockProjectField.key]: mockProjectKey },
          ],
          mockNodeSchema,
          kg,
        ),
      );

      expect(result).toEqual([
        { ...mockTask2Node, [mockProjectField.key]: mockProjectUid },
        { ...mockTask3Node, [mockProjectField.key]: mockProjectUid },
      ]);
    });
  });

  describe("formatReferencesList", () => {
    it("formats references in multiple entities", async () => {
      const result = throwIfError(
        await formatReferencesList(
          [mockTask2Node, mockTask3Node],
          mockNodeSchema,
          kg,
        ),
      );

      expect(result).toEqual([
        { ...mockTask2Node, [mockProjectField.key]: mockProjectKey },
        { ...mockTask3Node, [mockProjectField.key]: mockProjectKey },
      ]);
    });
  });
});
