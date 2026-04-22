import { describe, expect, it } from "bun:test";
import type {
  ChangesetsInput,
  EntitySchema,
  EntityType,
  Filters,
  FieldKey,
  FieldsetNested,
  RecordUid,
} from "@binder/repo";
import {
  mockRecordSchema,
  mockProjectRecord,
  mockProjectType,
  mockProjectTypeKey,
  mockProjectUid,
  mockTask1Record,
  mockTask1Uid,
  mockTask2Record,
  mockTask2Uid,
  mockTask3Record,
  mockTask3Uid,
  mockTaskTypeKey,
} from "@binder/repo/mocks";
import { isErr, omit, throwIfError } from "@binder/utils";
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
      const result = throwIfError(
        diffEntities(opts?.schema ?? schema, newEntity, oldEntity),
      );
      expect(result).toEqual(expected);
    };

    const checkError = (
      newEntity: FieldsetNested,
      oldEntity: FieldsetNested,
      pattern: string | RegExp,
      opts?: { schema?: EntitySchema },
    ) => {
      const result = diffEntities(opts?.schema ?? schema, newEntity, oldEntity);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message ?? result.error.key).toMatch(pattern);
      }
    };

    describe("field diffing", () => {
      it("returns empty changesets when fields are identical", () => {
        check(task1, task1, []);
      });

      it("emits update when field value changes", () => {
        check({ ...task1, title: "New Title" }, task1, [
          { uid: mockTask1Uid, title: "New Title" },
        ]);
      });

      it("ignores missing field in file (does not unset)", () => {
        check(omit(task1, ["status"]), task1, []);
      });

      it("emits update with null when field explicitly set to null", () => {
        check({ ...task1, status: null }, task1, [
          { uid: mockTask1Uid, status: null },
        ]);
      });

      it("emits multiple field changes in single changeset", () => {
        check({ ...task1, title: "New", status: "active" }, task1, [
          { uid: mockTask1Uid, title: "New", status: "active" },
        ]);
      });

      it("emits tag additions and removals as list mutations", () => {
        check({ ...task1, tags: ["urgent", "new-tag"] }, task1, [
          {
            uid: mockTask1Uid,
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
          [{ uid: mockProjectUid, title: "New Title" }],
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
          [{ uid: mockProjectUid, title: "New Title" }],
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
          [{ uid: mockTask1Uid, project: mockProjectUid }],
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
          [{ uid: mockTask1Uid, title: "Updated Task 1" }],
        );
      });

      it("emits remove mutation when child removed", () => {
        check(
          { ...project, tasks: [task1] },
          { ...project, tasks: [task1, task2] },
          [{ uid: mockProjectUid, tasks: [["remove", mockTask2Uid]] }],
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
              uid: mockProjectUid,
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
              uid: mockProjectUid,
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

      it("errors when range has multiple types and entity has no type", () => {
        // When the range is ambiguous and no type can be inferred, we must
        // error — emitting an orphan insert causes "Record not found" downstream.
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
        checkError(
          { ...project, tasks: [task1, { title: "Ambiguous Task" }] },
          { ...project, tasks: [task1] },
          /tasks/,
          { schema: multiRangeSchema },
        );
      });

      it("infers type from parent entity type only constraint when field has no global range", () => {
        // Milestone.contains has only: [Task] in the type schema even though
        // the global 'children' field has no range. We simulate this with
        // a project type that declares children with only: [Task].
        const schemaWithOnly: EntitySchema = {
          ...schema,
          types: {
            ...schema.types,
            [mockProjectTypeKey]: {
              ...mockProjectType,
              fields: [
                ...mockProjectType.fields,
                ["children" as FieldKey, { only: [mockTaskTypeKey] }],
              ],
            },
          },
        };
        check(
          {
            uid: mockProjectUid,
            type: mockProjectTypeKey,
            children: [{ title: "Sub Task" }],
          },
          { uid: mockProjectUid, type: mockProjectTypeKey, children: [] },
          [
            { uid: mockProjectUid, children: [["insert", expect.any(String)]] },
            expect.objectContaining({
              type: mockTaskTypeKey,
              title: "Sub Task",
            }),
          ],
          { schema: schemaWithOnly },
        );
      });

      it("errors when field has no range and parent type has no only constraint", () => {
        // 'children' has no global range and the Task type doesn't declare
        // an only constraint for it — type is unresolvable, must error.
        checkError(
          {
            uid: mockTask1Uid,
            type: mockTaskTypeKey,
            children: [{ title: "Sub Task" }],
          },
          { uid: mockTask1Uid, type: mockTaskTypeKey, children: [] },
          /children/,
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
          [{ uid: mockTask1Uid, title: "Implement user authentication v2" }],
        );
      });

      describe("string and tuple ref diffing", () => {
        // Regression: when all items in a relation+allowMultiple field are
        // strings or tuples (no nested fieldsets), extractOwnedChildren
        // returned empty for both sides and the diff returned null.

        it("detects added string ref", () => {
          check(
            {
              ...project,
              tasks: [mockTask1Uid, mockTask2Uid, mockTask3Uid],
            },
            {
              ...project,
              tasks: [mockTask1Uid, mockTask2Uid],
            },
            [
              {
                uid: mockProjectUid,
                tasks: [["insert", mockTask3Uid]],
              },
            ],
          );
        });

        it("detects removed string ref", () => {
          check(
            {
              ...project,
              tasks: [mockTask1Uid],
            },
            {
              ...project,
              tasks: [mockTask1Uid, mockTask2Uid],
            },
            [
              {
                uid: mockProjectUid,
                tasks: [["remove", mockTask2Uid]],
              },
            ],
          );
        });

        it("detects added tuple ref", () => {
          check(
            {
              ...project,
              tasks: [
                ["fieldA", { required: true }],
                "fieldB",
                "fieldC",
              ] as unknown as FieldsetNested[],
            },
            {
              ...project,
              tasks: [
                ["fieldA", { required: true }],
                "fieldB",
              ] as unknown as FieldsetNested[],
            },
            [
              {
                uid: mockProjectUid,
                tasks: [["insert", "fieldC"]],
              },
            ],
          );
        });

        it("detects no changes when refs are identical", () => {
          check(
            {
              ...project,
              tasks: [mockTask1Uid, mockTask2Uid],
            },
            {
              ...project,
              tasks: [mockTask1Uid, mockTask2Uid],
            },
            [],
          );
        });
      });

      it("throws on null in allowMultiple field during anonymous child matching", () => {
        // Documents the unguarded crash path in similarity-scorer. The
        // extraction fix in view.ts prevents null tombstones from reaching
        // here; this test confirms the crash path exists to justify that fix.
        expect(() =>
          diffEntities(
            schema,
            {
              ...project,
              tasks: [{ title: "Implement user authentication", tags: null }],
            },
            {
              ...project,
              tasks: [{ ...task1, tags: ["urgent", "important"] }],
            },
          ),
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
      const result = throwIfError(
        diffQueryResults(schema, newEntities, oldEntities, {
          filters: opts?.filters ?? {},
        }),
      );
      expect(result).toEqual(expected);
    };

    describe("matching and updates", () => {
      it("returns empty results when both lists are empty", () => {
        check([], [], { toCreate: [], toUpdate: [], toRemove: [] });
      });

      it("matches entities by uid and returns field updates", () => {
        check([{ ...task1, title: "Updated" }], [task1], {
          toCreate: [],
          toUpdate: [{ uid: mockTask1Uid, title: "Updated" }],
          toRemove: [],
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
                uid: mockTask1Uid,
                title: "Implement user authentication v2",
              },
            ],
            toRemove: [],
          },
        );
      });

      it("returns no updates when entities are identical", () => {
        check([task1], [task1], { toCreate: [], toUpdate: [], toRemove: [] });
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
            toRemove: [],
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
            toRemove: [mockTask1Uid],
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
            toRemove: [],
          },
          { filters: { status: "pending", project: mockProjectUid } },
        );
      });
    });

    describe("entity removal", () => {
      it("returns toRemove with uid when old entity absent from new list", () => {
        check([task1], [task1, task2], {
          toCreate: [],
          toUpdate: [],
          toRemove: [mockTask2Uid],
        });
      });

      it("returns empty toRemove when all old entities are matched", () => {
        check([task1, task2], [task1, task2], {
          toCreate: [],
          toUpdate: [],
          toRemove: [],
        });
      });

      it("returns multiple uids in toRemove when several entities removed", () => {
        check([], [task1, task2], {
          toCreate: [],
          toUpdate: [],
          toRemove: [mockTask1Uid, mockTask2Uid],
        });
      });
    });

    describe("mixed operations", () => {
      it("handles simultaneous create, update, and remove", () => {
        check(
          [
            { ...task1, title: "Updated" },
            {
              uid: "new-task-uid" as RecordUid,
              type: mockTaskTypeKey,
              title: "Brand New",
            },
          ],
          [task1, task2, mockTask3Record as FieldsetNested],
          {
            toCreate: [{ type: mockTaskTypeKey, title: "Brand New" }],
            toUpdate: [{ uid: mockTask1Uid, title: "Updated" }],
            toRemove: [mockTask2Uid, mockTask3Uid],
          },
        );
      });

      it("handles updates and creates in same batch", () => {
        check(
          [
            { ...task1, title: "Updated" },
            { type: mockTaskTypeKey, title: "New Task" },
          ],
          [task1],
          {
            toCreate: [{ type: mockTaskTypeKey, title: "New Task" }],
            toUpdate: [{ uid: mockTask1Uid, title: "Updated" }],
            toRemove: [],
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
              { uid: mockTask2Uid, title: "Task 2 Updated" },
              { uid: mockTask1Uid, title: "Task 1 Updated" },
            ],
            toRemove: [],
          },
        );
      });
    });
  });
});
