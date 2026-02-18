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
    ) => {
      const result = diffEntities(schema, newEntity, oldEntity);
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

    describe("nested relation diffing", () => {
      it("diffs nested single relation when uids match", () => {
        const oldWithProject = {
          ...task1,
          project: {
            uid: mockProjectUid,
            type: "Project",
            title: "Old Title",
          },
        };
        const newWithProject = {
          ...task1,
          project: {
            uid: mockProjectUid,
            type: "Project",
            title: "New Title",
          },
        };
        check(newWithProject, oldWithProject, [
          { $ref: mockProjectUid, title: "New Title" },
        ]);
      });

      it("ignores nested single relation when uids differ", () => {
        const oldWithProject = {
          ...task1,
          project: {
            uid: mockProjectUid,
            type: "Project",
            title: "Project A",
          },
        };
        const newWithProject = {
          ...task1,
          project: {
            uid: "other-project" as RecordUid,
            type: "Project",
            title: "Project B",
          },
        };
        check(newWithProject, oldWithProject, []);
      });

      it("diffs nested single relation when new has no uid (extracted from markdown)", () => {
        const oldWithProject = {
          ...task1,
          project: {
            uid: mockProjectUid,
            type: "Project",
            title: "Old Title",
          },
        };
        const newWithProject = {
          ...task1,
          project: { type: "Project", title: "New Title" },
        };
        check(newWithProject, oldWithProject, [
          { $ref: mockProjectUid, title: "New Title" },
        ]);
      });

      it("throws when old is UID string but new is nested (missing includes)", () => {
        const oldWithProject = {
          ...task1,
          project: mockProjectUid,
        };
        const newWithProject = {
          ...task1,
          project: { type: "Project", title: "New Title" },
        };
        expect(() =>
          diffEntities(schema, newWithProject, oldWithProject),
        ).toThrow(
          /relation field 'project'.*oldValue must be a nested fieldset/,
        );
      });

      it("emits update when single relation reference is set", () => {
        const oldTask = omit(task1, ["project"]) as FieldsetNested;
        const newTask = { ...task1, project: mockProjectUid };
        check(newTask, oldTask, [
          { $ref: mockTask1Uid, project: mockProjectUid },
        ]);
      });

      it("diffs multi-relation children and emits mutations", () => {
        const oldProject = {
          ...project,
          tasks: [
            { ...task1, title: "Original Task 1" },
            { ...task2, title: "Task 2" },
          ],
        };
        const newProject = {
          ...project,
          tasks: [
            { ...task1, title: "Updated Task 1" },
            { ...task2, title: "Task 2" },
          ],
        };
        check(newProject, oldProject, [
          { $ref: mockTask1Uid, title: "Updated Task 1" },
        ]);
      });

      it("emits remove mutation when child removed from multi-relation", () => {
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
        const result = diffEntities(
          multiRangeSchema,
          { ...project, tasks: [task1, { title: "Ambiguous Task" }] },
          { ...project, tasks: [task1] },
        );
        expect(result).toEqual([
          {
            $ref: mockProjectUid,
            tasks: [["insert", expect.any(String)]],
          },
        ]);
      });

      it("handles empty multi-relation arrays", () => {
        check({ ...project, tasks: [] }, { ...project, tasks: [] }, []);
      });
    });
  });

  describe("diffQueryResults", () => {
    const checkQuery = (
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
        checkQuery([], [], { toCreate: [], toUpdate: [] });
      });

      it("matches entities by uid and returns field updates", () => {
        checkQuery([{ ...task1, title: "Updated" }], [task1], {
          toCreate: [],
          toUpdate: [{ $ref: mockTask1Uid, title: "Updated" }],
        });
      });

      it("matches anonymous entities by similarity", () => {
        const { uid: _, ...anonTask1 } = task1;
        checkQuery(
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
        checkQuery([task1], [task1], { toCreate: [], toUpdate: [] });
      });
    });

    describe("entity creation", () => {
      it("creates entity when uid not found in old list", () => {
        const newTask = {
          uid: "new-task-uid" as RecordUid,
          type: mockTaskTypeKey,
          title: "Brand New Task",
          status: "pending",
        };
        checkQuery([newTask], [], {
          toCreate: [
            {
              type: mockTaskTypeKey,
              title: "Brand New Task",
              status: "pending",
            },
          ],
          toUpdate: [],
        });
      });

      it("creates entity when similarity below threshold", () => {
        const completelyDifferent = {
          type: mockTaskTypeKey,
          title: "Completely unrelated content here",
          status: "active",
          priority: "high",
        };
        const result = diffQueryResults(
          schema,
          [completelyDifferent],
          [task1],
          { filters: {} },
        );
        expect(result.toCreate).toEqual([
          expect.objectContaining({
            type: mockTaskTypeKey,
            title: "Completely unrelated content here",
          }),
        ]);
      });

      it("hydrates created entity with query context", () => {
        checkQuery(
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
        checkQuery(
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
        checkQuery(
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
