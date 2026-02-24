import { describe, expect, it } from "bun:test";
import type {
  ChangesetsInput,
  EntitySchema,
  EntityType,
  Filters,
  FieldsetNested,
  RecordUid,
} from "@binder/db";
import {
  mockRecordSchema,
  mockProjectRecord,
  mockProjectUid,
  mockTask1Record,
  mockTask1Uid,
  mockTask2Record,
  mockTask2Uid,
  mockTaskTypeKey,
} from "@binder/db/mocks";
import { omit } from "@binder/utils";
import {
  diffEntities,
  diffQueryResults,
  type DiffQueryResult,
} from "./entity-diff.ts";

describe("entity-diff", () => {
  const schema = mockRecordSchema;

  const task1 = mockTask1Record as FieldsetNested;
  const task2 = mockTask2Record as FieldsetNested;
  const project = mockProjectRecord as FieldsetNested;

  describe("diffEntities", () => {
    const check = (
      newEntity: FieldsetNested,
      oldEntity: FieldsetNested,
      expected: ChangesetsInput,
      opts?: { schema?: EntitySchema },
    ) => {
      const result = diffEntities(opts?.schema ?? schema, newEntity, oldEntity);
      expect(result).toEqual(expected);
    };

    describe("field diffing", () => {
      it("returns empty changesets when fields are identical", () => {
        check(task1, task1, []);
      });

      it("emits update when field value changes", () => {
        check({ ...task1, title: "New Title" }, task1, [
          { $ref: mockTask1Uid, title: "New Title" },
        ]);
      });

      it("ignores missing field in file (does not unset)", () => {
        check(omit(task1, ["status"]), task1, []);
      });

      it("emits update with null when field explicitly set to null", () => {
        check({ ...task1, status: null }, task1, [
          { $ref: mockTask1Uid, status: null },
        ]);
      });

      it("emits multiple field changes in single changeset", () => {
        check({ ...task1, title: "New", status: "active" }, task1, [
          { $ref: mockTask1Uid, title: "New", status: "active" },
        ]);
      });

      it("emits tag additions and removals as list mutations", () => {
        check({ ...task1, tags: ["urgent", "new-tag"] }, task1, [
          {
            $ref: mockTask1Uid,
            tags: [
              ["remove", "important"],
              ["insert", "new-tag"],
            ],
          },
        ]);
      });
    });

    describe("single relation diffing", () => {
      it("diffs nested fields when uids match", () => {
        check(
          {
            ...task1,
            project: {
              uid: mockProjectUid,
              type: "Project",
              title: "New Title",
            },
          },
          {
            ...task1,
            project: {
              uid: mockProjectUid,
              type: "Project",
              title: "Old Title",
            },
          },
          [{ $ref: mockProjectUid, title: "New Title" }],
        );
      });

      it("ignores when uids differ", () => {
        check(
          {
            ...task1,
            project: {
              uid: "other-project" as RecordUid,
              type: "Project",
              title: "Project B",
            },
          },
          {
            ...task1,
            project: {
              uid: mockProjectUid,
              type: "Project",
              title: "Project A",
            },
          },
          [],
        );
      });

      it("diffs when new has no uid (extracted from markdown)", () => {
        check(
          { ...task1, project: { type: "Project", title: "New Title" } },
          {
            ...task1,
            project: {
              uid: mockProjectUid,
              type: "Project",
              title: "Old Title",
            },
          },
          [{ $ref: mockProjectUid, title: "New Title" }],
        );
      });

      it("throws when old is UID string but new is nested (missing includes)", () => {
        expect(() =>
          diffEntities(
            schema,
            { ...task1, project: { type: "Project", title: "New Title" } },
            { ...task1, project: mockProjectUid },
          ),
        ).toThrow(
          /relation field 'project'.*oldValue must be a nested fieldset/,
        );
      });

      it("emits update when relation reference is set", () => {
        check(
          { ...task1, project: mockProjectUid },
          omit(task1, ["project"]) as FieldsetNested,
          [{ $ref: mockTask1Uid, project: mockProjectUid }],
        );
      });
    });

    describe("multi-relation diffing", () => {
      it("diffs children and emits field update", () => {
        check(
          {
            ...project,
            tasks: [
              { ...task1, title: "Updated Task 1" },
              { ...task2, title: "Task 2" },
            ],
          },
          {
            ...project,
            tasks: [
              { ...task1, title: "Original Task 1" },
              { ...task2, title: "Task 2" },
            ],
          },
          [{ $ref: mockTask1Uid, title: "Updated Task 1" }],
        );
      });

      it("emits remove mutation when child removed", () => {
        check(
          { ...project, tasks: [task1] },
          { ...project, tasks: [task1, task2] },
          [{ $ref: mockProjectUid, tasks: [["remove", mockTask2Uid]] }],
        );
      });

      it("emits insert mutation with generated uid when anonymous child added", () => {
        check(
          {
            ...project,
            tasks: [task1, { type: mockTaskTypeKey, title: "New Task" }],
          },
          { ...project, tasks: [task1] },
          [
            {
              $ref: mockProjectUid,
              tasks: [["insert", expect.any(String)]],
            },
            expect.objectContaining({
              type: mockTaskTypeKey,
              title: "New Task",
              uid: expect.any(String),
            }),
          ],
        );
      });

      it("infers type from single-type range when child has no type", () => {
        check(
          { ...project, tasks: [task1, { title: "New Task" }] },
          { ...project, tasks: [task1] },
          [
            {
              $ref: mockProjectUid,
              tasks: [["insert", expect.any(String)]],
            },
            expect.objectContaining({
              type: mockTaskTypeKey,
              title: "New Task",
              uid: expect.any(String),
            }),
          ],
        );
      });

      it("emits insert but no create when range has multiple types", () => {
        const multiRangeSchema: EntitySchema = {
          ...schema,
          fields: {
            ...schema.fields,
            tasks: {
              ...schema.fields.tasks,
              range: [mockTaskTypeKey, "OtherType" as EntityType],
            },
          },
        };
        check(
          { ...project, tasks: [task1, { title: "Ambiguous Task" }] },
          { ...project, tasks: [task1] },
          [
            {
              $ref: mockProjectUid,
              tasks: [["insert", expect.any(String)]],
            },
          ],
          { schema: multiRangeSchema },
        );
      });

      it("handles empty arrays", () => {
        check({ ...project, tasks: [] }, { ...project, tasks: [] }, []);
      });

      it("matches anonymous children with sparse fields against old children", () => {
        // Regression: extraction with base={} produced null tombstones for
        // empty allowMultiple fields (e.g. tags: null). These flowed through
        // diffOwnedChildren → matchEntities → compareFieldValues and crashed
        // on assertIsArray(null).
        //
        // The extraction fix threads the correct base so children are sparse
        // diffs (only changed fields, no null tombstones).
        check(
          {
            ...project,
            tasks: [
              { title: "Implement user authentication v2" },
              { title: "Implement schema generator" },
            ],
          },
          {
            ...project,
            tasks: [
              { ...task1, tags: ["urgent", "important"] },
              { ...task2, tags: ["backend"] },
            ],
          },
          [{ $ref: mockTask1Uid, title: "Implement user authentication v2" }],
        );
      });

      it("throws on null in allowMultiple field during anonymous child matching", () => {
        // Documents the unguarded crash path in similarity-scorer. The
        // extraction fix in template.ts prevents null tombstones from reaching
        // here; this test confirms the crash path exists to justify that fix.
        expect(() =>
          diffEntities(schema, {
            ...project,
            tasks: [{ title: "Implement user authentication", tags: null }],
          }, {
            ...project,
            tasks: [{ ...task1, tags: ["urgent", "important"] }],
          }),
        ).toThrow(/is not an array: null/);
      });
    });
  });

  describe("diffQueryResults", () => {
    const check = (
      newEntities: FieldsetNested[],
      oldEntities: FieldsetNested[],
      expected: DiffQueryResult,
      opts?: { filters?: Filters },
    ) => {
      const result = diffQueryResults(schema, newEntities, oldEntities, {
        filters: opts?.filters ?? {},
      });
      expect(result).toEqual(expected);
    };

    describe("matching and updates", () => {
      it("returns empty results when both lists are empty", () => {
        check([], [], { toCreate: [], toUpdate: [] });
      });

      it("matches entities by uid and returns field updates", () => {
        check([{ ...task1, title: "Updated" }], [task1], {
          toCreate: [],
          toUpdate: [{ $ref: mockTask1Uid, title: "Updated" }],
        });
      });

      it("matches anonymous entities by similarity", () => {
        const { uid: _, ...anonTask1 } = task1;
        check(
          [{ ...anonTask1, title: "Implement user authentication v2" }],
          [task1],
          {
            toCreate: [],
            toUpdate: [
              {
                $ref: mockTask1Uid,
                title: "Implement user authentication v2",
              },
            ],
          },
        );
      });

      it("returns no updates when entities are identical", () => {
        check([task1], [task1], { toCreate: [], toUpdate: [] });
      });
    });

    describe("entity creation", () => {
      it("creates entity when uid not found in old list", () => {
        check(
          [
            {
              uid: "new-task-uid" as RecordUid,
              type: mockTaskTypeKey,
              title: "Brand New Task",
              status: "pending",
            },
          ],
          [],
          {
            toCreate: [
              {
                type: mockTaskTypeKey,
                title: "Brand New Task",
                status: "pending",
              },
            ],
            toUpdate: [],
          },
        );
      });

      it("creates entity when similarity below threshold", () => {
        check(
          [
            {
              type: mockTaskTypeKey,
              title: "Completely unrelated content here",
              status: "active",
              priority: "high",
            },
          ],
          [task1],
          {
            toCreate: [
              expect.objectContaining({
                type: mockTaskTypeKey,
                title: "Completely unrelated content here",
              }),
            ],
            toUpdate: [],
          },
        );
      });

      it("hydrates created entity with query context", () => {
        check(
          [{ type: mockTaskTypeKey, title: "New Task" }],
          [],
          {
            toCreate: [
              {
                type: mockTaskTypeKey,
                title: "New Task",
                status: "pending",
                project: mockProjectUid,
              },
            ],
            toUpdate: [],
          },
          { filters: { status: "pending", project: mockProjectUid } },
        );
      });
    });

    describe("mixed operations", () => {
      it("handles updates and creates in same batch", () => {
        check(
          [
            { ...task1, title: "Updated" },
            { type: mockTaskTypeKey, title: "New Task" },
          ],
          [task1],
          {
            toCreate: [{ type: mockTaskTypeKey, title: "New Task" }],
            toUpdate: [{ $ref: mockTask1Uid, title: "Updated" }],
          },
        );
      });

      it("matches multiple entities by uid in different order", () => {
        check(
          [
            { ...task2, title: "Task 2 Updated" },
            { ...task1, title: "Task 1 Updated" },
          ],
          [task1, task2],
          {
            toCreate: [],
            toUpdate: [
              { $ref: mockTask2Uid, title: "Task 2 Updated" },
              { $ref: mockTask1Uid, title: "Task 1 Updated" },
            ],
          },
        );
      });
    });
  });
});
