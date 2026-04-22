import { beforeEach, describe, expect, it } from "bun:test";
import { omit, throwIfError, throwIfValue } from "@binder/utils";
import "@binder/utils/tests";
import {
  mockProjectKey,
  mockProjectRecord,
  mockProjectUid,
  mockTask1Record,
  mockTask1Uid,
  mockTask2Record,
  mockTask2Uid,
  mockTask3Record,
  mockTask3Uid,
  mockTaskWithOwnersRecord,
  mockTaskWithOwnersUid,
  mockUser2Record,
  mockUser2Uid,
  mockUserRecord,
  mockUserUid,
} from "./model/record.mock.ts";
import { getTestDatabase, insertConfig, insertRecord } from "./db.mock.ts";
import { type Database } from "./db.ts";
import { processChangesetInput } from "./changeset-processor";
import {
  type ConfigKey,
  coreConfigSchema,
  type EntitiesChangeset,
  type EntityChangesetInput,
  type EntityId,
  type Fieldset,
  fieldSystemType,
  GENESIS_ENTITY_ID,
  type NamespaceEditable,
  type RecordKey,
  type RecordUid,
} from "./model";
import { createEntity, fetchEntityFieldset } from "./entity-store.ts";
import { applyChangeset as applyChangesetToDb } from "./changeset-applier.ts";
import { saveTransaction } from "./transaction-store.ts";
import { mockTransactionInit } from "./model/transaction.mock.ts";
import { mockRecordSchema } from "./model/schema.mock.ts";
import {
  mockAssignedToFieldKey,
  mockPartnerFieldKey,
  mockProjectFieldKey,
  mockProjectTypeKey,
  mockRelatedToFieldKey,
  mockTasksFieldKey,
  mockTaskType,
  mockTaskTypeKey,
  mockTeamTypeKey,
  mockUserTypeKey,
} from "./model/config.mock.ts";

describe("changeset processor relations", () => {
  let db: Database;

  beforeEach(() => {
    db = getTestDatabase();
  });

  const process = async (
    inputs: EntityChangesetInput<NamespaceEditable>[],
    namespace: NamespaceEditable = "record",
  ) => {
    const schema = namespace === "config" ? coreConfigSchema : mockRecordSchema;
    return db.transaction(async (tx) =>
      processChangesetInput(tx, namespace, inputs, schema, GENESIS_ENTITY_ID),
    );
  };

  const checkErrors = async (
    inputs: EntityChangesetInput<NamespaceEditable>[],
    expectedErrors: object[],
    namespace?: NamespaceEditable,
  ) => {
    const result = await process(inputs, namespace);
    expect(result).toBeErrWithKey("changeset-input-process-failed");
    const error = throwIfValue(result);
    expect((error.data as { errors: object[] }).errors).toEqual(expectedErrors);
  };

  const checkSuccess = async (
    inputs: EntityChangesetInput<NamespaceEditable>[],
    namespace?: NamespaceEditable,
  ) => {
    const result = await process(inputs, namespace);
    expect(result).toBeOk();
  };

  const setup = async (...entities: Fieldset[]) => {
    await db.transaction(async (tx) => {
      for (const entity of entities) {
        await createEntity(tx, "record", entity);
      }
      await saveTransaction(tx, mockTransactionInit);
    });
  };

  describe("delete", () => {
    it("creates deletion changeset for record entity", async () => {
      await insertRecord(db, mockTask1Record);

      const result = throwIfError(
        await process([{ uid: mockTask1Uid, $delete: true }]),
      );

      expect(result).toEqual({
        [mockTask1Uid]: {
          id: ["clear", mockTask1Record.id],
          uid: ["clear", mockTask1Record.uid],
          key: ["clear", mockTask1Record.key],
          type: ["clear", mockTask1Record.type],
          title: ["clear", mockTask1Record.title],
          description: ["clear", mockTask1Record.description],
          status: ["clear", mockTask1Record.status],
          priority: ["clear", mockTask1Record.priority],
          tags: [
            "seq",
            [
              ["remove", "urgent"],
              ["remove", "important"],
            ],
          ],
        },
      });
    });

    it("creates deletion changeset for config entity", async () => {
      await insertConfig(db, mockTaskType);

      const result = throwIfError(
        await process([{ uid: mockTaskType.uid, $delete: true }], "config"),
      );

      expect(result).toEqual({
        [mockTaskTypeKey]: {
          id: ["clear", mockTaskType.id],
          uid: ["clear", mockTaskType.uid],
          key: ["clear", mockTaskType.key],
          type: ["clear", mockTaskType.type],
          name: ["clear", mockTaskType.name],
          description: ["clear", mockTaskType.description],
          fields: ["seq", mockTaskType.fields.map((f) => ["remove", f])],
        },
      });
    });

    it("returns error when deleting non-existent entity", async () => {
      const result = await process([
        { uid: "_nonexistent" as RecordUid, $delete: true },
      ]);
      expect(result).toBeErr();
    });

    it("clears relation fields on deleted entity", async () => {
      await setup(mockProjectRecord, mockTask3Record);

      const result = throwIfError(
        await process([{ uid: mockTask3Uid, $delete: true }]),
      );

      expect(result[mockTask3Uid]).toMatchObject({
        [mockProjectFieldKey]: ["clear", mockProjectUid],
      });
    });

    it("cleans up non-inverse incoming single-value references", async () => {
      const taskWithAssignee = {
        ...omit(mockTask1Record, ["tags"]),
        [mockAssignedToFieldKey]: mockUserUid,
      };
      await setup(mockUserRecord, taskWithAssignee);

      const result = throwIfError(
        await process([{ uid: mockUserUid, $delete: true }]),
      );

      expect(result[mockTask1Uid]).toEqual({
        [mockAssignedToFieldKey]: ["clear", mockUserUid],
      });
    });

    it("cleans up non-inverse incoming multi-value references", async () => {
      const teamRecord = {
        id: 100 as EntityId,
        uid: mockTaskWithOwnersUid,
        type: mockTeamTypeKey,
        members: [mockUserUid],
      };
      await setup(mockUserRecord, teamRecord);

      const result = throwIfError(
        await process([{ uid: mockUserUid, $delete: true }]),
      );

      expect(result[mockTaskWithOwnersUid]).toEqual({
        members: ["seq", [["remove", mockUserUid]]],
      });
    });

    it("does not double-clean inverse relation fields", async () => {
      const task1WithRelated = {
        ...omit(mockTask1Record, ["tags"]),
        [mockRelatedToFieldKey]: [mockTask2Uid],
      } as Fieldset;
      const task2WithRelated = {
        ...omit(mockTask2Record, ["project"]),
        [mockRelatedToFieldKey]: [mockTask1Uid],
      } as Fieldset;
      await setup(task1WithRelated, task2WithRelated);

      const result = throwIfError(
        await process([{ uid: mockTask1Uid, $delete: true }]),
      );

      expect(result[mockTask2Uid]).toEqual({
        [mockRelatedToFieldKey]: ["seq", [["remove", mockTask1Uid]]],
      });
    });
  });

  describe("relation key resolution", () => {
    const mockUserKey = "user-rick" as RecordKey;
    const mockUserWithKey = { ...mockUserRecord, key: mockUserKey };
    const mockTeamRecord = {
      id: 100 as EntityId,
      uid: mockTaskWithOwnersUid,
      type: mockTeamTypeKey,
      members: [],
    };

    const check = async (
      inputs: EntityChangesetInput<"record">[],
      expectedField: string,
      expectedValue: unknown,
    ) => {
      const result = throwIfError(await process(inputs));
      const recordUids = Object.keys(result) as RecordUid[];
      const recordChangeset = result[recordUids[0]!];

      expect(recordChangeset[expectedField]).toEqual(expectedValue as any);
    };

    it("resolves relation keys to UIDs in record changesets", async () => {
      await setup(mockProjectRecord);
      await check(
        [{ type: mockTaskTypeKey, title: "Task", project: mockProjectKey }],
        "project",
        mockProjectRecord.uid,
      );
    });

    it("resolves relation keys to UIDs in array relation fields", async () => {
      await setup(mockUserWithKey);
      await check(
        [{ type: mockTeamTypeKey, members: [mockUserKey] }],
        "members",
        [mockUserUid],
      );
    });

    it("resolves relation keys in list mutation insert", async () => {
      await setup(mockUserWithKey, mockTeamRecord);
      await check(
        [{ uid: mockTaskWithOwnersUid, members: [["insert", mockUserKey]] }],
        "members",
        ["seq", [["insert", mockUserUid]]],
      );
    });

    it("resolves relation keys in tuple format with attributes", async () => {
      await setup(mockUserWithKey, mockTeamRecord);
      await check(
        [
          {
            uid: mockTaskWithOwnersUid,
            members: [["insert", [mockUserKey, { role: "admin" }]]],
          },
        ],
        "members",
        ["seq", [["insert", [mockUserUid, { role: "admin" }]]]],
      );
    });

    it("resolves intra-batch keys in single relation field", async () => {
      const result = throwIfError(
        await process([
          {
            type: mockProjectTypeKey,
            key: mockProjectKey,
            title: "Project",
          },
          { type: mockTaskTypeKey, title: "Task", project: mockProjectKey },
        ]),
      );

      const projectChangeset = Object.values(result).find(
        (cs) => cs.key === mockProjectKey,
      );
      const taskChangeset = Object.values(result).find(
        (cs) => cs.title === "Task",
      );

      expect(taskChangeset!.project).toBe(projectChangeset!.uid);
    });

    it("resolves intra-batch keys in array relation field", async () => {
      const result = throwIfError(
        await process([
          { type: mockUserTypeKey, key: mockUserKey, name: "Alice" },
          { type: mockTeamTypeKey, members: [mockUserKey] },
        ]),
      );

      const userChangeset = Object.values(result).find(
        (cs) => cs.key === mockUserKey,
      );
      const teamChangeset = Object.values(result).find(
        (cs) => cs.type === mockTeamTypeKey,
      );

      expect(teamChangeset!.members).toEqual([userChangeset!.uid as RecordUid]);
    });
  });

  describe("inverse relations", () => {
    const checkInverseExpansion = async (
      entities: Fieldset[],
      input: EntityChangesetInput<"record">,
      expected: EntitiesChangeset<"record">,
    ) => {
      await setup(...entities);
      const result = throwIfError(await process([input]));
      expect(result).toEqual(expected);
    };

    const applyAndCommit = async (changeset: EntitiesChangeset<"record">) => {
      await db.transaction(async (tx) => {
        for (const [ref, fieldChangeset] of Object.entries(changeset)) {
          throwIfError(
            await applyChangesetToDb(
              tx,
              "record",
              ref as RecordUid,
              fieldChangeset,
            ),
          );
        }
        await saveTransaction(tx, mockTransactionInit);
      });
    };

    const getField = async (uid: RecordUid, field: string) =>
      db.transaction(async (tx) => {
        const result = throwIfError(
          await fetchEntityFieldset(tx, "record", uid, [field]),
        );
        return result[field];
      });

    const findChangeset = (
      result: EntitiesChangeset<"record">,
      predicate: (changeset: Record<string, unknown>) => boolean,
    ) => {
      const changeset = Object.values(result).find(predicate)!;
      const uid = Object.keys(result).find(
        (recordUid) => result[recordUid as RecordUid] === changeset,
      ) as RecordUid;
      return { changeset, uid };
    };

    describe("one-to-many", () => {
      const task2Unlinked = omit(mockTask2Record, ["project"]);
      const task3Unlinked = omit(mockTask3Record, ["project"]);
      const otherProjectUid = "_projOther0" as RecordUid;
      const otherProject = {
        ...mockProjectRecord,
        id: 10 as EntityId,
        uid: otherProjectUid,
        key: "other-project" as RecordKey,
        title: "Other Project",
      };

      it("translates remove mutation to direct field update", () =>
        checkInverseExpansion(
          [mockProjectRecord, mockTask2Record],
          {
            uid: mockProjectUid,
            [mockTasksFieldKey]: [["remove", mockTask2Uid]],
          },
          {
            [mockTask2Uid]: {
              [mockProjectFieldKey]: ["set", null, mockProjectUid],
            },
          },
        ));

      it("translates insert mutation to direct field update", () =>
        checkInverseExpansion(
          [mockProjectRecord, task2Unlinked],
          {
            uid: mockProjectUid,
            [mockTasksFieldKey]: [["insert", mockTask2Uid]],
          },
          {
            [mockTask2Uid]: {
              [mockProjectFieldKey]: ["set", mockProjectUid],
            },
          },
        ));

      it("translates insert when target already has different parent", () =>
        checkInverseExpansion(
          [mockProjectRecord, otherProject, mockTask2Record],
          {
            uid: otherProjectUid,
            [mockTasksFieldKey]: [["insert", mockTask2Uid]],
          },
          {
            [mockTask2Uid]: {
              [mockProjectFieldKey]: ["set", otherProjectUid, mockProjectUid],
            },
          },
        ));

      it("handles mixed insert and remove mutations", () =>
        checkInverseExpansion(
          [mockProjectRecord, mockTask2Record, task3Unlinked],
          {
            uid: mockProjectUid,
            [mockTasksFieldKey]: [
              ["remove", mockTask2Uid],
              ["insert", mockTask3Uid],
            ],
          },
          {
            [mockTask2Uid]: {
              [mockProjectFieldKey]: ["set", null, mockProjectUid],
            },
            [mockTask3Uid]: {
              [mockProjectFieldKey]: ["set", mockProjectUid],
            },
          },
        ));

      it("strips inverse field from parent changeset while keeping other fields", async () => {
        await setup(mockProjectRecord, task2Unlinked);
        const result = throwIfError(
          await process([
            {
              uid: mockProjectUid,
              title: "Updated Project Title",
              [mockTasksFieldKey]: [["insert", mockTask2Uid]],
            },
          ]),
        );
        expect(result[mockProjectUid]).toEqual({
          title: ["set", "Updated Project Title", mockProjectRecord.title],
        });
        expect(result[mockTask2Uid]).toEqual({
          [mockProjectFieldKey]: ["set", mockProjectUid],
        });
      });

      it("produces no parent changeset when only inverse field is updated", async () => {
        await setup(mockProjectRecord, task2Unlinked);
        const result = throwIfError(
          await process([
            {
              uid: mockProjectUid,
              [mockTasksFieldKey]: [["insert", mockTask2Uid]],
            },
          ]),
        );
        expect(result[mockProjectUid]).toBeUndefined();
        expect(result[mockTask2Uid]).toBeDefined();
      });

      it("creates new entity and updates child direct fields", async () => {
        await setup(task2Unlinked);
        const result = throwIfError(
          await process([
            {
              type: mockProjectTypeKey,
              title: "New Project",
              [mockTasksFieldKey]: [["insert", mockTask2Uid]],
            },
          ]),
        );

        const { changeset: projectChangeset, uid: projectUid } = findChangeset(
          result,
          (changeset) => changeset.title === "New Project",
        );

        expect(projectChangeset[mockTasksFieldKey]).toBeUndefined();
        expect(result[mockTask2Uid]).toEqual({
          [mockProjectFieldKey]: ["set", projectUid],
        });
      });
    });

    describe("one-to-one", () => {
      const user3Uid = "_userBirdP0" as RecordUid;
      const user4Uid = "_userSqunch" as RecordUid;
      const userWithPartner = {
        ...mockUserRecord,
        [mockPartnerFieldKey]: mockUser2Uid,
      } as Fieldset;
      const user2WithPartner = {
        ...mockUser2Record,
        [mockPartnerFieldKey]: mockUserUid,
      } as Fieldset;

      const createUser = (
        id: EntityId,
        uid: RecordUid,
        name: string,
        partner?: RecordUid,
      ) =>
        ({
          ...mockUser2Record,
          id,
          uid,
          name,
          ...(partner ? { [mockPartnerFieldKey]: partner } : {}),
        }) as Fieldset;

      const checkDisplacement = (
        result: EntitiesChangeset<"record">,
        sourceUid: RecordUid,
      ) => {
        expect(result[mockUser2Uid]).toEqual({
          [mockPartnerFieldKey]: ["set", sourceUid, mockUserUid],
        });
        expect(result[mockUserUid]).toEqual({
          [mockPartnerFieldKey]: ["set", null, mockUser2Uid],
        });
      };

      it("setting field generates inverse set on target", () =>
        checkInverseExpansion(
          [mockUserRecord, mockUser2Record],
          {
            uid: mockUserUid,
            [mockPartnerFieldKey]: mockUser2Uid,
          },
          {
            [mockUserUid]: {
              [mockPartnerFieldKey]: ["set", mockUser2Uid],
            },
            [mockUser2Uid]: {
              [mockPartnerFieldKey]: ["set", mockUserUid],
            },
          },
        ));

      it("clearing field clears inverse on old target", () =>
        checkInverseExpansion(
          [userWithPartner, user2WithPartner],
          {
            uid: mockUserUid,
            [mockPartnerFieldKey]: null,
          },
          {
            [mockUserUid]: {
              [mockPartnerFieldKey]: ["set", null, mockUser2Uid],
            },
            [mockUser2Uid]: {
              [mockPartnerFieldKey]: ["set", null, mockUserUid],
            },
          },
        ));

      it("replacing field updates both old and new targets", async () => {
        await setup(
          userWithPartner,
          user2WithPartner,
          createUser(7 as EntityId, user3Uid, "Birdperson"),
        );
        const result = throwIfError(
          await process([
            { uid: mockUserUid, [mockPartnerFieldKey]: user3Uid },
          ]),
        );

        expect(result).toEqual({
          [mockUserUid]: {
            [mockPartnerFieldKey]: ["set", user3Uid, mockUser2Uid],
          },
          [user3Uid]: {
            [mockPartnerFieldKey]: ["set", mockUserUid],
          },
          [mockUser2Uid]: {
            [mockPartnerFieldKey]: ["set", null, mockUserUid],
          },
        });
      });

      describe("displacement", () => {
        it("creating entity that displaces existing inverse clears displaced entity", async () => {
          await setup(userWithPartner, user2WithPartner);

          const result = throwIfError(
            await process([
              {
                type: mockUserTypeKey,
                uid: user3Uid,
                name: "Birdperson",
                [mockPartnerFieldKey]: mockUser2Uid,
              },
            ]),
          );

          checkDisplacement(result, user3Uid);
        });

        it("updating field that displaces target inverse clears displaced entity", async () => {
          await setup(
            userWithPartner,
            user2WithPartner,
            createUser(7 as EntityId, user3Uid, "Birdperson"),
          );

          const result = throwIfError(
            await process([
              { uid: user3Uid, [mockPartnerFieldKey]: mockUser2Uid },
            ]),
          );

          checkDisplacement(result, user3Uid);
        });

        it("displacement changeset applies and produces consistent state", async () => {
          await setup(
            userWithPartner,
            user2WithPartner,
            createUser(7 as EntityId, user3Uid, "Birdperson"),
          );

          const result = throwIfError(
            await process([
              { uid: user3Uid, [mockPartnerFieldKey]: mockUser2Uid },
            ]),
          );
          await applyAndCommit(result);

          expect(await getField(user3Uid, mockPartnerFieldKey)).toBe(
            mockUser2Uid,
          );
          expect(await getField(mockUser2Uid, mockPartnerFieldKey)).toBe(
            user3Uid,
          );
          expect(
            await getField(mockUserUid, mockPartnerFieldKey),
          ).toBeUndefined();
        });
      });

      describe("inconsistent state recovery", () => {
        it("clearing field on entity with inconsistent inverse succeeds", async () => {
          await setup(
            {
              ...mockUserRecord,
              [mockPartnerFieldKey]: mockUser2Uid,
            } as Fieldset,
            {
              ...mockUser2Record,
              [mockPartnerFieldKey]: user3Uid,
            } as Fieldset,
            createUser(7 as EntityId, user3Uid, "Birdperson", mockUser2Uid),
          );

          const result = throwIfError(
            await process([{ uid: mockUserUid, [mockPartnerFieldKey]: null }]),
          );

          expect(result).toEqual({
            [mockUserUid]: {
              [mockPartnerFieldKey]: ["set", null, mockUser2Uid],
            },
          });

          await applyAndCommit(result);
          expect(
            await getField(mockUserUid, mockPartnerFieldKey),
          ).toBeUndefined();
          expect(await getField(mockUser2Uid, mockPartnerFieldKey)).toBe(
            user3Uid,
          );
          expect(await getField(user3Uid, mockPartnerFieldKey)).toBe(
            mockUser2Uid,
          );
        });

        it("replacing field on entity with inconsistent inverse succeeds", async () => {
          await setup(
            {
              ...mockUserRecord,
              [mockPartnerFieldKey]: mockUser2Uid,
            } as Fieldset,
            {
              ...mockUser2Record,
              [mockPartnerFieldKey]: user3Uid,
            } as Fieldset,
            createUser(7 as EntityId, user3Uid, "Birdperson", mockUser2Uid),
            createUser(8 as EntityId, user4Uid, "Squanchy"),
          );

          const result = throwIfError(
            await process([
              { uid: mockUserUid, [mockPartnerFieldKey]: user4Uid },
            ]),
          );

          await applyAndCommit(result);
          expect(await getField(mockUserUid, mockPartnerFieldKey)).toBe(
            user4Uid,
          );
          expect(await getField(user4Uid, mockPartnerFieldKey)).toBe(
            mockUserUid,
          );
          expect(await getField(mockUser2Uid, mockPartnerFieldKey)).toBe(
            user3Uid,
          );
          expect(await getField(user3Uid, mockPartnerFieldKey)).toBe(
            mockUser2Uid,
          );
        });
      });
    });

    describe("many-to-many", () => {
      const task1WithRelated = {
        ...mockTask1Record,
        [mockRelatedToFieldKey]: [mockTask2Uid],
      } as Fieldset;
      const task2WithRelated = {
        ...mockTask2Record,
        [mockRelatedToFieldKey]: [mockTask1Uid],
      } as Fieldset;

      it("insert generates insert on inverse side", () =>
        checkInverseExpansion(
          [mockTask1Record, mockTask3Record],
          {
            uid: mockTask1Uid,
            [mockRelatedToFieldKey]: [["insert", mockTask3Uid]],
          },
          {
            [mockTask1Uid]: {
              [mockRelatedToFieldKey]: ["seq", [["insert", mockTask3Uid]]],
            },
            [mockTask3Uid]: {
              [mockRelatedToFieldKey]: ["seq", [["insert", mockTask1Uid]]],
            },
          },
        ));

      it("remove generates remove on inverse side", () =>
        checkInverseExpansion(
          [task1WithRelated, task2WithRelated],
          {
            uid: mockTask1Uid,
            [mockRelatedToFieldKey]: [["remove", mockTask2Uid]],
          },
          {
            [mockTask1Uid]: {
              [mockRelatedToFieldKey]: ["seq", [["remove", mockTask2Uid]]],
            },
            [mockTask2Uid]: {
              [mockRelatedToFieldKey]: ["seq", [["remove", mockTask1Uid]]],
            },
          },
        ));

      it("mixed insert and remove mirrors to inverse side", () =>
        checkInverseExpansion(
          [task1WithRelated, task2WithRelated, mockTask3Record],
          {
            uid: mockTask1Uid,
            [mockRelatedToFieldKey]: [
              ["remove", mockTask2Uid],
              ["insert", mockTask3Uid],
            ],
          },
          {
            [mockTask1Uid]: {
              [mockRelatedToFieldKey]: [
                "seq",
                [
                  ["remove", mockTask2Uid],
                  ["insert", mockTask3Uid],
                ],
              ],
            },
            [mockTask2Uid]: {
              [mockRelatedToFieldKey]: ["seq", [["remove", mockTask1Uid]]],
            },
            [mockTask3Uid]: {
              [mockRelatedToFieldKey]: ["seq", [["insert", mockTask1Uid]]],
            },
          },
        ));
    });

    describe("intra-batch", () => {
      it("1:M - insert referencing new entity in same batch", async () => {
        const result = throwIfError(
          await process([
            {
              type: mockTaskTypeKey,
              key: "new-task" as RecordKey,
              title: "New Task",
            },
            {
              type: mockProjectTypeKey,
              title: "New Project",
              [mockTasksFieldKey]: [["insert", "new-task"]],
            },
          ]),
        );

        const { uid: taskUid } = findChangeset(
          result,
          (changeset) => changeset.key === "new-task",
        );
        const { changeset: projectChangeset, uid: projectUid } = findChangeset(
          result,
          (changeset) => changeset.title === "New Project",
        );

        expect(projectChangeset[mockTasksFieldKey]).toBeUndefined();
        expect(result[taskUid]).toMatchObject({
          [mockProjectFieldKey]: ["set", projectUid],
        });
      });

      it("1:1 - setting field on new entity referencing another new entity", async () => {
        const result = throwIfError(
          await process([
            {
              type: mockUserTypeKey,
              key: "user-a" as RecordKey,
              name: "Alice",
            },
            {
              type: mockUserTypeKey,
              key: "user-b" as RecordKey,
              name: "Bob",
              [mockPartnerFieldKey]: "user-a",
            },
          ]),
        );

        const { uid: userAUid } = findChangeset(
          result,
          (changeset) => changeset.key === "user-a",
        );
        const { changeset: userBChangeset, uid: userBUid } = findChangeset(
          result,
          (changeset) => changeset.key === "user-b",
        );

        expect(userBChangeset[mockPartnerFieldKey]).toBe(userAUid);
        expect(result[userAUid]).toMatchObject({
          [mockPartnerFieldKey]: ["set", userBUid],
        });
      });

      it("M:M - insert referencing new entity in same batch", async () => {
        const result = throwIfError(
          await process([
            {
              type: mockTaskTypeKey,
              key: "task-a" as RecordKey,
              title: "Task A",
            },
            {
              type: mockTaskTypeKey,
              key: "task-b" as RecordKey,
              title: "Task B",
              [mockRelatedToFieldKey]: [["insert", "task-a"]],
            },
          ]),
        );

        const { uid: taskAUid } = findChangeset(
          result,
          (changeset) => changeset.key === "task-a",
        );
        const { changeset: taskBChangeset, uid: taskBUid } = findChangeset(
          result,
          (changeset) => changeset.key === "task-b",
        );

        expect(taskBChangeset[mockRelatedToFieldKey]).toEqual([
          ["insert", taskAUid],
        ]);
        expect(result[taskAUid]).toMatchObject({
          [mockRelatedToFieldKey]: ["seq", [["insert", taskBUid]]],
        });
      });
    });
  });

  describe("validation", () => {
    describe("patch", () => {
      beforeEach(async () => {
        await insertRecord(db, mockTaskWithOwnersRecord);
      });

      it("validates patch attrs against field attributes", async () => {
        await checkErrors(
          [
            {
              uid: mockTaskWithOwnersRecord.uid,
              owners: [["patch", "user-1", { role: 123 }]],
            },
          ],
          [
            {
              index: 0,
              namespace: "record",
              field: "owners.role",
              message: "Expected string for plaintext, got: number",
            },
          ],
        );
      });

      it("accepts valid patch attrs", async () => {
        await checkSuccess([
          {
            uid: mockTaskWithOwnersRecord.uid,
            owners: [["patch", "user-1", { role: "admin" }]],
          },
        ]);
      });

      it("ignores patch attrs not in field attributes", async () => {
        await checkSuccess([
          {
            uid: mockTaskWithOwnersRecord.uid,
            owners: [["patch", "user-1", { unknownAttr: "value" }]],
          },
        ]);
      });

      it("validates single patch mutation", async () => {
        await checkErrors(
          [
            {
              uid: mockTaskWithOwnersRecord.uid,
              owners: ["patch", "user-1", { role: false }],
            },
          ],
          [
            {
              index: 0,
              namespace: "record",
              field: "owners.role",
              message: "Expected string for plaintext, got: boolean",
            },
          ],
        );
      });
    });

    describe("inverseOf", () => {
      it("accepts inverseOf on single-value relation field (1:1)", () =>
        checkSuccess(
          [
            {
              type: fieldSystemType,
              key: "myParent" as ConfigKey,
              dataType: "relation",
            },
            {
              type: fieldSystemType,
              key: "oneToOneField" as ConfigKey,
              dataType: "relation",
              inverseOf: "myParent",
            },
          ],
          "config",
        ));

      it("rejects inverseOf referencing non-existent field", () =>
        checkErrors(
          [
            {
              type: fieldSystemType,
              key: "badField" as ConfigKey,
              dataType: "relation",
              allowMultiple: true,
              inverseOf: "nonExistentField",
            },
          ],
          [
            {
              index: 0,
              namespace: "config",
              field: "inverseOf",
              message:
                'inverseOf references non-existent field "nonExistentField"',
            },
          ],
          "config",
        ));

      it("rejects inverseOf referencing non-relation field", () =>
        checkErrors(
          [
            {
              type: fieldSystemType,
              key: "badField" as ConfigKey,
              dataType: "relation",
              allowMultiple: true,
              inverseOf: "name",
            },
          ],
          [
            {
              index: 0,
              namespace: "config",
              field: "inverseOf",
              message:
                'inverseOf must reference a relation field, but "name" has dataType "plaintext"',
            },
          ],
          "config",
        ));

      it("rejects single-value inverseOf referencing allowMultiple field", () =>
        checkErrors(
          [
            {
              type: fieldSystemType,
              key: "myChildren" as ConfigKey,
              dataType: "relation",
              allowMultiple: true,
              inverseOf: "myParent",
            },
            {
              type: fieldSystemType,
              key: "myParent" as ConfigKey,
              dataType: "relation",
            },
            {
              type: fieldSystemType,
              key: "badField" as ConfigKey,
              dataType: "relation",
              inverseOf: "myChildren",
            },
          ],
          [
            {
              index: 2,
              namespace: "config",
              field: "inverseOf",
              message:
                'inverseOf on a single-value field cannot reference an allowMultiple field "myChildren". Place inverseOf on the allowMultiple side instead.',
            },
          ],
          "config",
        ));

      it("rejects inverseOf when target points to a different field", () =>
        checkErrors(
          [
            {
              type: fieldSystemType,
              key: "myParent" as ConfigKey,
              dataType: "relation",
            },
            {
              type: fieldSystemType,
              key: "myChildren" as ConfigKey,
              dataType: "relation",
              allowMultiple: true,
              inverseOf: "myParent",
            },
            {
              type: fieldSystemType,
              key: "sideA" as ConfigKey,
              dataType: "relation",
              allowMultiple: true,
              inverseOf: "myChildren",
            },
          ],
          [
            {
              index: 2,
              namespace: "config",
              field: "inverseOf",
              message:
                'inverseOf target "myChildren" has inverseOf="myParent" which does not point back to "sideA"',
            },
          ],
          "config",
        ));

      it("accepts symmetric self-referential inverseOf (1:1)", () =>
        checkSuccess(
          [
            {
              type: fieldSystemType,
              key: "partner" as ConfigKey,
              dataType: "relation",
              inverseOf: "partner",
            },
          ],
          "config",
        ));

      it("accepts symmetric self-referential inverseOf (M:M)", () =>
        checkSuccess(
          [
            {
              type: fieldSystemType,
              key: "relatedTo" as ConfigKey,
              dataType: "relation",
              allowMultiple: true,
              inverseOf: "relatedTo",
            },
          ],
          "config",
        ));

      it("accepts M:M inverseOf when both sides point to each other", () =>
        checkSuccess(
          [
            {
              type: fieldSystemType,
              key: "linksTo" as ConfigKey,
              dataType: "relation",
              allowMultiple: true,
              inverseOf: "linkedFrom",
            },
            {
              type: fieldSystemType,
              key: "linkedFrom" as ConfigKey,
              dataType: "relation",
              allowMultiple: true,
              inverseOf: "linksTo",
            },
          ],
          "config",
        ));

      it("accepts 1:M inverseOf on allowMultiple field referencing single-value field", () =>
        checkSuccess(
          [
            {
              type: fieldSystemType,
              key: "myParent" as ConfigKey,
              dataType: "relation",
            },
            {
              type: fieldSystemType,
              key: "validInverseField" as ConfigKey,
              dataType: "relation",
              allowMultiple: true,
              inverseOf: "myParent",
            },
          ],
          "config",
        ));
    });
  });
});
