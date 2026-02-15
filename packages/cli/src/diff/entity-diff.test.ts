import { describe, expect, it } from "bun:test";
import {
  type ChangesetsInput,
  type FieldsetNested,
  type RecordUid,
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
import { diffEntities, diffQueryResults } from "./entity-diff.ts";

describe("diffEntities", () => {
  const schema = mockRecordSchema;

  const task1 = mockTask1Record as FieldsetNested;
  const task2 = mockTask2Record as FieldsetNested;
  const project = mockProjectRecord as FieldsetNested;

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
        project: { uid: mockProjectUid, type: "Project", title: "Old Title" },
      };
      const newWithProject = {
        ...task1,
        project: { uid: mockProjectUid, type: "Project", title: "New Title" },
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
        project: { uid: mockProjectUid, type: "Project", title: "Old Title" },
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
        project: mockProjectUid, // Just UID string, not expanded object
      };
      const newWithProject = {
        ...task1,
        project: { type: "Project", title: "New Title" },
      };
      expect(() =>
        diffEntities(schema, newWithProject, oldWithProject),
      ).toThrow(/relation field 'project'.*oldValue must be a nested fieldset/);
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
      const oldProject = {
        ...project,
        tasks: [task1, task2],
      };
      const newProject = {
        ...project,
        tasks: [task1],
      };
      const result = diffEntities(schema, newProject, oldProject);
      expect(result).toEqual([
        {
          $ref: mockProjectUid,
          tasks: [["remove", mockTask2Uid]],
        },
      ]);
    });

    it("emits insert mutation with generated uid when anonymous child added", () => {
      const oldProject = {
        ...project,
        tasks: [task1],
      };
      const newProject = {
        ...project,
        tasks: [task1, { type: mockTaskTypeKey, title: "New Task" }],
      };
      const result = diffEntities(schema, newProject, oldProject);

      expect(result).toEqual([
        {
          $ref: mockProjectUid,
          tasks: [["insert", expect.any(String)]],
        },
        expect.objectContaining({
          type: mockTaskTypeKey,
          title: "New Task",
          uid: expect.any(String),
        }),
      ]);
    });
  });

  describe("edge cases", () => {
    it("handles empty multi-relation arrays", () => {
      const oldProject = { ...project, tasks: [] };
      const newProject = { ...project, tasks: [] };
      check(newProject, oldProject, []);
    });
  });
});

describe("diffQueryResults", () => {
  const schema = mockRecordSchema;

  const task1 = mockTask1Record as FieldsetNested;
  const task2 = mockTask2Record as FieldsetNested;
  const { uid: _, ...anonTask1 } = task1;

  describe("matching and updates", () => {
    it("returns empty results when both lists are empty", () => {
      const result = diffQueryResults(schema, [], [], { filters: {} });
      expect(result).toEqual({ toCreate: [], toUpdate: [] });
    });

    it("matches entities by uid and returns field updates", () => {
      const result = diffQueryResults(
        schema,
        [{ ...task1, title: "Updated" }],
        [task1],
        { filters: {} },
      );
      expect(result).toEqual({
        toCreate: [],
        toUpdate: [{ $ref: mockTask1Uid, title: "Updated" }],
      });
    });

    it("matches anonymous entities by similarity", () => {
      const result = diffQueryResults(
        schema,
        [{ ...anonTask1, title: "Implement user authentication v2" }],
        [task1],
        { filters: {} },
      );
      expect(result).toEqual({
        toCreate: [],
        toUpdate: [
          { $ref: mockTask1Uid, title: "Implement user authentication v2" },
        ],
      });
    });

    it("returns no updates when entities are identical", () => {
      const result = diffQueryResults(schema, [task1], [task1], {
        filters: {},
      });
      expect(result).toEqual({ toCreate: [], toUpdate: [] });
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
      const result = diffQueryResults(schema, [newTask], [], { filters: {} });
      expect(result).toEqual({
        toCreate: [
          { type: mockTaskTypeKey, title: "Brand New Task", status: "pending" },
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
      const result = diffQueryResults(schema, [completelyDifferent], [task1], {
        filters: {},
      });
      expect(result.toCreate).toEqual([
        expect.objectContaining({
          type: mockTaskTypeKey,
          title: "Completely unrelated content here",
        }),
      ]);
    });

    it("hydrates created entity with query context", () => {
      const newTask = { type: mockTaskTypeKey, title: "New Task" };
      const result = diffQueryResults(schema, [newTask], [], {
        filters: { status: "pending", project: mockProjectUid },
      });
      expect(result.toCreate).toEqual([
        {
          type: mockTaskTypeKey,
          title: "New Task",
          status: "pending",
          project: mockProjectUid,
        },
      ]);
    });
  });

  describe("mixed operations", () => {
    it("handles updates and creates in same batch", () => {
      const newTask = { type: mockTaskTypeKey, title: "New Task" };
      const result = diffQueryResults(
        schema,
        [{ ...task1, title: "Updated" }, newTask],
        [task1],
        { filters: {} },
      );
      expect(result).toEqual({
        toCreate: [{ type: mockTaskTypeKey, title: "New Task" }],
        toUpdate: [{ $ref: mockTask1Uid, title: "Updated" }],
      });
    });

    it("matches multiple entities by uid in different order", () => {
      const result = diffQueryResults(
        schema,
        [
          { ...task2, title: "Task 2 Updated" },
          { ...task1, title: "Task 1 Updated" },
        ],
        [task1, task2],
        { filters: {} },
      );
      expect(result).toEqual({
        toCreate: [],
        toUpdate: [
          { $ref: mockTask2Uid, title: "Task 2 Updated" },
          { $ref: mockTask1Uid, title: "Task 1 Updated" },
        ],
      });
    });
  });
});
