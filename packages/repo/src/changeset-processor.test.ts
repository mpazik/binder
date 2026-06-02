import { beforeEach, describe, expect, it } from "bun:test";
import { type ErrorObject, throwIfError, throwIfValue } from "@binder/utils";
import "@binder/utils/tests";
import {
  mockProjectKey,
  mockProjectRecord,
  mockProjectUid,
  mockTask1Key,
  mockTask1Record,
  mockTask1Uid,
  mockUserRecord,
  mockUserUid,
} from "./model/record.mock.ts";
import { mockChangesetUpdateTask1 } from "./model/changeset.mock.ts";
import { computeTextDiff } from "./model/text-diff.ts";
import { getTestDatabase, insertConfig, insertRecord } from "./db.mock.ts";
import { type Database } from "./db.ts";
import { processChangesetInput } from "./changeset-processor";
import {
  type ConfigKey,
  type ConfigType,
  coreConfigSchema,
  type EntityChangesetInput,
  type FieldChangeset,
  fieldSystemType,
  GENESIS_ENTITY_ID,
  type NamespaceEditable,
  type RecordKey,
  typeSystemType,
} from "./model";
import { mockRecordSchema } from "./model/schema.mock.ts";
import {
  mockFieldKeyEmail,
  mockNotExistingRecordTypeKey,
  mockPriorityField,
  mockPriorityFieldKey,
  mockProjectTypeKey,
  mockTaskTypeKey,
  mockUserTypeKey,
} from "./model/config.mock.ts";
import {
  mockChangesetInputCreateTask1,
  mockChangesetInputUpdateTask1,
} from "./model/changeset-input.mock.ts";

describe("changeset processor", () => {
  let db: Database;

  beforeEach(() => {
    db = getTestDatabase();
  });

  describe("processChangesetInput", () => {
    const invalidConfigType = "InvalidConfigType" as ConfigType;
    const testFieldKey = "testField" as ConfigKey;

    const process = async (
      inputs: EntityChangesetInput<NamespaceEditable>[],
      namespace: NamespaceEditable = "record",
    ) => {
      const schema =
        namespace === "config" ? coreConfigSchema : mockRecordSchema;
      return await db.transaction(async (tx) =>
        processChangesetInput(tx, namespace, inputs, schema, GENESIS_ENTITY_ID),
      );
    };

    const expectError = async (
      inputs: EntityChangesetInput<NamespaceEditable>[],
      expectedError: ErrorObject,
      namespace?: NamespaceEditable,
    ) => {
      const result = await process(inputs, namespace);
      const error = throwIfValue(result);
      expect(error).toEqual(expectedError);
    };

    const checkErrors = async (
      inputs: EntityChangesetInput<NamespaceEditable>[],
      expectedErrors: object[],
      namespace?: NamespaceEditable,
    ) => {
      const result = await process(inputs, namespace);
      expect(result).toBeErrWithKey("changeset-input-process-failed");
      const error = throwIfValue(result);
      expect((error.data as { errors: object[] }).errors).toEqual(
        expectedErrors,
      );
    };

    const checkSuccess = async (
      inputs: EntityChangesetInput<NamespaceEditable>[],
      namespace?: NamespaceEditable,
    ) => {
      const result = await process(inputs, namespace);
      expect(result).toBeOk();
    };

    const insertTask1 = async () => {
      await insertRecord(db, mockTask1Record);
    };

    describe("changeset creation", () => {
      const checkChangeset = async (
        input: EntityChangesetInput<NamespaceEditable>,
        expected: FieldChangeset,
        namespace?: NamespaceEditable,
      ) => {
        const result = throwIfError(await process([input], namespace));
        expect(Object.values(result)[0]).toEqual(expected);
      };

      it("creates changeset for updated entity", async () => {
        await insertTask1();
        await checkChangeset(
          mockChangesetInputUpdateTask1,
          mockChangesetUpdateTask1,
        );
      });

      it("auto-converts raw string input to diff on diff-encoded text field", async () => {
        await insertTask1();
        const newDescription =
          "Add login and signup functionality with JWT tokens";
        await checkChangeset(
          { uid: mockTask1Uid, description: newDescription },
          {
            description: [
              "diff",
              computeTextDiff(mockTask1Record.description, newDescription),
            ],
          },
        );
      });

      it("passes diff-encoded input through verbatim on diff-encoded field", async () => {
        await insertTask1();
        const ops = computeTextDiff(
          mockTask1Record.description,
          "Add login and signup functionality with JWT tokens",
        );
        await checkChangeset(
          { uid: mockTask1Uid, description: ["diff", ops] },
          { description: ["diff", ops] },
        );
      });

      it("drops no-op diff changes from the changeset", async () => {
        await insertTask1();
        await checkChangeset(
          {
            uid: mockTask1Uid,
            description: mockTask1Record.description,
            title: "Updated title",
          },
          { title: ["set", "Updated title", mockTask1Record.title] },
        );
      });

      it("drops no-op set changes from the changeset", async () => {
        await insertTask1();
        await checkChangeset(
          {
            uid: mockTask1Uid,
            status: mockTask1Record.status, // restated unchanged
            title: "Updated title",
          },
          { title: ["set", "Updated title", mockTask1Record.title] },
        );
      });

      it("drops no-op explicit diff input (only retain ops)", async () => {
        await insertTask1();
        const noopOps = [
          ["retain", mockTask1Record.description.length],
        ] as const;
        await checkChangeset(
          {
            uid: mockTask1Uid,
            description: ["diff", noopOps] as unknown as string,
            title: "Another title",
          },
          { title: ["set", "Another title", mockTask1Record.title] },
        );
      });

      it("rejects diff-encoded input on a field that does not support diff changes", async () => {
        await insertTask1();

        await checkErrors(
          [
            {
              uid: mockTask1Uid,
              title: ["diff", [["retain", 5]]] as unknown as string,
            },
          ],
          [
            {
              index: 0,
              namespace: "record",
              field: "title",
              message: "field does not support diff-encoded changes",
            },
          ],
        );
      });

      it("creates changeset for new config entity with uid field", async () => {
        const result = throwIfError(
          await process(
            [
              {
                type: fieldSystemType,
                key: testFieldKey,
                dataType: "plaintext",
              },
            ],
            "config",
          ),
        );
        expect(result[testFieldKey]).toMatchObject({
          uid: expect.any(String),
          key: testFieldKey,
          type: fieldSystemType,
          dataType: "plaintext",
        });
      });
    });

    describe("upsert", () => {
      it("creates a new entity when the key does not exist", async () => {
        const result = throwIfError(
          await process([
            {
              type: mockTaskTypeKey,
              key: "brand-new-task" as RecordKey,
              title: "New",
            },
          ]),
        );
        const [ref, changeset] = Object.entries(result)[0]!;
        expect(changeset).toMatchObject({
          key: "brand-new-task",
          type: mockTaskTypeKey,
          title: "New",
        });
        expect(ref).not.toBe(mockTask1Uid);
      });

      it("updates the existing entity when the key already exists", async () => {
        await insertTask1();
        const result = throwIfError(
          await process([
            { type: mockTaskTypeKey, key: mockTask1Key, title: "Renamed" },
          ]),
        );
        // update changeset keyed by the existing uid, carries the prior value,
        // and no `type` (updates never restate type)
        expect(result[mockTask1Uid]).toEqual({
          title: ["set", "Renamed", mockTask1Record.title],
        });
      });

      it("routes the same create-shaped input to create when absent, update when present", async () => {
        // The create mock carries `type` + `key` + `uid`: on an empty store it
        // creates, and re-running it once the record exists updates in place.
        const created = throwIfError(
          await process([mockChangesetInputCreateTask1]),
        );
        expect(created[mockTask1Uid]).toMatchObject({
          key: mockTask1Record.key,
          type: mockTask1Record.type,
          title: mockTask1Record.title,
        });

        await insertTask1();
        const updated = throwIfError(
          await process([
            { ...mockChangesetInputCreateTask1, title: "Renamed" },
          ]),
        );
        // resolves to an update keyed by the existing uid (no new uid, no
        // duplicate-key error); restated unchanged fields are dropped, leaving
        // only the title change
        expect(updated[mockTask1Uid]).toEqual({
          title: ["set", "Renamed", mockTask1Record.title],
        });
      });

      it("applies update semantics on the existing path (skips mandatory check)", async () => {
        await insertTask1();
        // `title` is mandatory for create; an upsert resolving to an existing
        // record must not require it.
        await checkSuccess([
          { type: mockTaskTypeKey, key: mockTask1Key, status: "active" },
        ]);
      });

      it("does not raise a uniqueness error when upserting in place", async () => {
        await insertRecord(db, mockUserRecord);
        // A pure create with this email would collide; the upsert resolves to
        // an update of the same record, changing only the name.
        await checkSuccess([
          {
            type: mockUserTypeKey,
            uid: mockUserUid,
            name: "Rick Sanchez",
            [mockFieldKeyEmail]: "rick@example.com",
          } as EntityChangesetInput<"record">,
        ]);
      });

      it("errors when the upsert type mismatches the existing entity", async () => {
        await insertTask1();
        await checkErrors(
          [{ type: mockProjectTypeKey, key: mockTask1Key, title: "x" }],
          [
            {
              index: 0,
              namespace: "record",
              field: "type",
              message: `type "${mockProjectTypeKey}" does not match existing record entity ${mockTask1Key} of type "${mockTaskTypeKey}"`,
            },
          ],
        );
      });

      it("resolves a relation ref to an existing upserted entity, not a new uid", async () => {
        await insertRecord(db, mockProjectRecord);
        const result = throwIfError(
          await process([
            // upsert the project (exists → update)
            {
              type: mockProjectTypeKey,
              key: mockProjectKey,
              title: "Renamed project",
            },
            // create a task that references the project by key
            {
              type: mockTaskTypeKey,
              key: "task-with-project" as RecordKey,
              title: "Task",
              project: mockProjectKey,
            },
          ]),
        );
        const taskChangeset = Object.values(result).find(
          (changeset) => (changeset as FieldChangeset).project !== undefined,
        ) as FieldChangeset;
        expect(taskChangeset.project).toBe(mockProjectUid);
      });

      it("resolves a batch mixing create and update", async () => {
        await insertTask1();
        const result = throwIfError(
          await process([
            { type: mockTaskTypeKey, key: mockTask1Key, title: "Updated 1" },
            {
              type: mockTaskTypeKey,
              key: "fresh-task" as RecordKey,
              title: "Created",
            },
          ]),
        );
        // existing → update keyed by its uid
        expect(result[mockTask1Uid]).toEqual({
          title: ["set", "Updated 1", mockTask1Record.title],
        });
        // new → create keyed by a freshly minted uid
        const createRef = Object.keys(result).find(
          (ref) => ref !== mockTask1Uid,
        )!;
        expect(
          result[createRef as keyof typeof result] as FieldChangeset,
        ).toMatchObject({
          key: "fresh-task",
          type: mockTaskTypeKey,
          title: "Created",
        });
      });
    });

    describe("default values", () => {
      const check = async (
        input: EntityChangesetInput<"record">,
        expected: Record<string, unknown>,
      ) => {
        const result = throwIfError(await process([input]));
        expect(Object.values(result)[0]).toMatchObject(expected);
      };

      it("includes field default values in changeset for new entity", () =>
        check(
          { type: mockTaskTypeKey, title: "Task without priority" },
          { priority: "medium", status: "pending" },
        ));

      it("includes type-level default over field-level default", () =>
        check(
          { type: mockProjectTypeKey, title: "Project" },
          { status: "active" },
        ));

      it("does not override user-provided value with default", () =>
        check(
          { type: mockTaskTypeKey, title: "Task", priority: "high" },
          { priority: "high" },
        ));

      it("skips default when 'when' condition is not met", async () => {
        const result = throwIfError(
          await process([
            {
              type: mockTaskTypeKey,
              title: "Pending Task",
              status: "pending",
            },
          ]),
        );
        expect(Object.values(result)[0]).not.toHaveProperty("completedAt");
      });

      it("applies default when 'when' condition is met", () =>
        check(
          {
            type: mockTaskTypeKey,
            title: "Complete Task",
            status: "complete",
          },
          { completedAt: "2024-01-01T00:00:00.000Z" },
        ));

      it("accepts Field with valid default matching dataType", () =>
        checkSuccess(
          [
            {
              type: fieldSystemType,
              key: "testDefaultField" as ConfigKey,
              dataType: "plaintext",
              default: "hello",
            },
          ],
          "config",
        ));

      it("accepts Field with integer default", () =>
        checkSuccess(
          [
            {
              type: fieldSystemType,
              key: "testIntField" as ConfigKey,
              dataType: "integer",
              default: 42,
            },
          ],
          "config",
        ));

      it("accepts Field with boolean default", () =>
        checkSuccess(
          [
            {
              type: fieldSystemType,
              key: "testBoolField" as ConfigKey,
              dataType: "boolean",
              default: true,
            },
          ],
          "config",
        ));

      it("rejects Field with default not matching dataType", () =>
        checkErrors(
          [
            {
              type: fieldSystemType,
              key: "testBadDefault" as ConfigKey,
              dataType: "integer",
              default: "not a number",
            },
          ],
          [
            {
              index: 0,
              namespace: "config",
              field: "default",
              message: expect.stringContaining(
                "default value does not match dataType 'integer'",
              ),
            },
          ],
          "config",
        ));

      it("rejects Type with field attr default not matching field dataType", () =>
        checkErrors(
          [
            {
              type: typeSystemType,
              key: "TestTypeBadDefault" as ConfigKey,
              name: "Test Type",
              fields: [["name", { default: 123 }]],
            },
          ],
          [
            {
              index: 0,
              namespace: "config",
              field: "fields.name.default",
              message: expect.stringContaining(
                "default value does not match dataType 'plaintext'",
              ),
            },
          ],
          "config",
        ));

      it("accepts Field with option default matching valid option", () =>
        checkSuccess(
          [
            {
              type: fieldSystemType,
              key: "testOptionField" as ConfigKey,
              dataType: "option",
              options: [{ key: "a" }, { key: "b" }],
              default: "a",
            },
          ],
          "config",
        ));

      it("rejects Field with option default not in options list", () =>
        checkErrors(
          [
            {
              type: fieldSystemType,
              key: "testBadOptionField" as ConfigKey,
              dataType: "option",
              options: [{ key: "a" }, { key: "b" }],
              default: "invalid",
            },
          ],
          [
            {
              index: 0,
              namespace: "config",
              field: "default",
              message: expect.stringContaining(
                "Invalid option value: invalid. Expected one of: a, b",
              ),
            },
          ],
          "config",
        ));
    });

    describe("validation", () => {
      it("rejects create with invalid record type", () =>
        expectError(
          [{ type: mockNotExistingRecordTypeKey, name: "Test Item" }],
          {
            key: "changeset-input-process-failed",
            message: "failed creating changeset",
            data: {
              errors: [
                {
                  index: 0,
                  namespace: "record",
                  field: "type",
                  message: "invalid type: NotExistingRecordType",
                },
              ],
            },
          },
        ));

      it("rejects create with invalid config type", () =>
        expectError(
          [{ type: invalidConfigType, key: testFieldKey }],
          {
            key: "changeset-input-process-failed",
            message: "failed creating changeset",
            data: {
              errors: [
                {
                  index: 0,
                  namespace: "config",
                  field: "type",
                  message: "invalid type: InvalidConfigType",
                },
              ],
            },
          },
          "config",
        ));

      it("rejects create missing mandatory property", () =>
        checkErrors(
          [{ type: mockTaskTypeKey }],
          [
            {
              index: 0,
              namespace: "record",
              field: "title",
              message: "mandatory property is missing or null",
            },
          ],
        ));

      it("accepts create without conditional required field when condition not met", () =>
        checkSuccess([
          { type: mockTaskTypeKey, title: "Task", status: "pending" },
        ]));

      it("rejects create missing conditional required field when condition is met", () =>
        checkErrors(
          [
            {
              type: mockTaskTypeKey,
              title: "Cancelled Task",
              status: "cancelled",
            },
          ],
          [
            {
              index: 0,
              namespace: "record",
              field: "cancelReason",
              message: "mandatory property is missing or null",
            },
          ],
        ));

      it("accepts create with conditional required field when condition is met", () =>
        checkSuccess([
          {
            type: mockTaskTypeKey,
            title: "Cancelled Task",
            status: "cancelled",
            cancelReason: "No longer needed",
          },
        ]));

      it("rejects update to status triggering conditional required field", async () => {
        await insertTask1();
        await checkErrors(
          [{ uid: mockTask1Record.uid, status: "cancelled" }],
          [
            {
              index: 0,
              namespace: "record",
              field: "cancelReason",
              message: "mandatory property is missing or null",
            },
          ],
        );
      });

      it("accepts update to status with conditional required field provided", async () => {
        await insertTask1();
        await checkSuccess([
          {
            uid: mockTask1Record.uid,
            status: "cancelled",
            cancelReason: "Project cancelled",
          },
        ]);
      });

      it("rejects create missing multiple mandatory properties", () =>
        checkErrors(
          [{ type: fieldSystemType }],
          [
            {
              index: 0,
              namespace: "config",
              field: "key",
              message: "mandatory property is missing or null",
            },
            {
              index: 0,
              namespace: "config",
              field: "dataType",
              message: "mandatory property is missing or null",
            },
          ],
          "config",
        ));

      it("validates multiple changesets and reports all errors", () =>
        checkErrors(
          [
            { type: mockTaskTypeKey },
            {
              title: "Updated Task",
            } as unknown as EntityChangesetInput<"record">,
          ],
          [
            {
              index: 0,
              namespace: "record",
              field: "title",
              message: "mandatory property is missing or null",
            },
            {
              index: 1,
              namespace: "record",
              field: "type",
              message: "type is required for create entity changeset",
            },
          ],
        ));

      it("rejects undefined fields in schema for create and update", async () => {
        await insertTask1();
        await checkErrors(
          [
            {
              type: mockTaskTypeKey,
              title: "Test Task",
              invalidField: "test value",
            } as EntityChangesetInput<"record">,
            { uid: mockTask1Uid, anotherInvalidField: "test" },
          ],
          [
            {
              index: 0,
              namespace: "record",
              field: "invalidField",
              message: 'field "invalidField" is not defined in schema',
            },
            {
              index: 1,
              namespace: "record",
              field: "anotherInvalidField",
              message: 'field "anotherInvalidField" is not defined in schema',
            },
          ],
        );
      });

      it("rejects reserved keys on create and update", async () => {
        await insertConfig(db, mockPriorityField);
        await checkErrors(
          [
            {
              type: fieldSystemType,
              key: "first" as ConfigKey,
              dataType: "plaintext",
            },
            { uid: mockPriorityField.uid, key: "last" as ConfigKey },
          ],
          [
            {
              index: 0,
              namespace: "config",
              field: "key",
              message: 'key "first" is reserved and cannot be used',
            },
            {
              index: 1,
              namespace: "config",
              field: "key",
              message: 'key "last" is reserved and cannot be used',
            },
          ],
          "config",
        );
      });

      it("rejects keys that match the UID format", async () => {
        await insertConfig(db, mockPriorityField);
        await checkErrors(
          [
            {
              type: fieldSystemType,
              key: "_0a1b2c3d4e" as ConfigKey,
              dataType: "plaintext",
            },
            { uid: mockPriorityField.uid, key: "0a1b2c3d4e5" as ConfigKey },
          ],
          [
            {
              index: 0,
              namespace: "config",
              field: "key",
              message:
                'key "_0a1b2c3d4e" is ambiguous because it matches the UID format',
            },
            {
              index: 1,
              namespace: "config",
              field: "key",
              message:
                'key "0a1b2c3d4e5" is ambiguous because it matches the UID format',
            },
          ],
          "config",
        );
      });

      it("validates field data types", () =>
        checkErrors(
          [
            {
              type: fieldSystemType,
              key: testFieldKey,
              dataType: 123 as unknown as string,
            },
          ],
          [
            {
              index: 0,
              namespace: "config",
              field: "dataType",
              message: "Expected non-empty string for option",
            },
          ],
          "config",
        ));

      it("validates option values against allowed options", () =>
        checkErrors(
          [
            {
              type: fieldSystemType,
              key: testFieldKey,
              dataType: "invalidDataType",
            },
          ],
          [
            {
              index: 0,
              namespace: "config",
              field: "dataType",
              message: expect.stringContaining(
                "Invalid option value: invalidDataType",
              ),
            },
          ],
          "config",
        ));

      const createStatusOnlySchema = () => {
        const schema = structuredClone(mockRecordSchema);
        schema.types[mockTaskTypeKey].fields = schema.types[
          mockTaskTypeKey
        ].fields.map((ref) =>
          (Array.isArray(ref) ? ref[0] : ref) === "status"
            ? ["status", { only: ["pending", "active"] }]
            : ref,
        );
        return schema;
      };

      const checkStatusOnlyConstraintError = async (
        input: EntityChangesetInput<"record">,
      ) => {
        const result = await db.transaction(async (tx) =>
          processChangesetInput(
            tx,
            "record",
            [input],
            createStatusOnlySchema(),
            GENESIS_ENTITY_ID,
          ),
        );

        expect(result).toBeErrWithKey("changeset-input-process-failed");
        const error = throwIfValue(result);
        expect((error.data as { errors: object[] }).errors).toEqual([
          {
            index: 0,
            namespace: "record",
            field: "status",
            message: expect.stringContaining("Invalid option value: complete"),
          },
        ]);
      };

      it("enforces type-level only constraints for option fields on create", () =>
        checkStatusOnlyConstraintError({
          type: mockTaskTypeKey,
          title: "Task with invalid status",
          status: "complete",
        }));

      it("enforces type-level only constraints for option fields on update", async () => {
        await insertTask1();
        await checkStatusOnlyConstraintError({
          uid: mockTask1Uid,
          status: "complete",
        });
      });

      it("validates values in list mutations", async () => {
        await insertTask1();
        await checkErrors(
          [
            {
              uid: mockTask1Record.uid,
              tags: [
                ["insert", 123 as unknown as string, 0],
                ["remove", 456 as unknown as string, 1],
              ],
            },
          ],
          [
            {
              index: 0,
              namespace: "record",
              field: "tags",
              message: expect.stringContaining("Invalid insert value"),
            },
            {
              index: 0,
              namespace: "record",
              field: "tags",
              message: expect.stringContaining("Invalid remove value"),
            },
          ],
        );
      });

      it("accepts valid list mutations", async () => {
        await insertTask1();
        await checkSuccess([
          {
            uid: mockTask1Record.uid,
            tags: [
              ["insert", "urgent", 0],
              ["remove", "important", 1],
            ],
          },
        ]);
      });

      it("rejects duplicate unique field value", async () => {
        await insertRecord(db, mockUserRecord);
        await checkErrors(
          [
            {
              type: mockUserTypeKey,
              name: "Richard",
              [mockFieldKeyEmail]: "rick@example.com",
            },
          ],
          [
            {
              index: 0,
              namespace: "record",
              field: mockFieldKeyEmail,
              message: expect.stringContaining(
                "value must be unique, already exists",
              ),
            },
          ],
        );
      });

      it("rejects updates to immutable fields", async () => {
        await insertConfig(db, mockPriorityField);
        await checkErrors(
          [
            { key: mockPriorityFieldKey, dataType: "integer" },
            { key: mockPriorityFieldKey, allowMultiple: true },
            { key: mockPriorityFieldKey, unique: true },
          ],
          [
            {
              index: 0,
              namespace: "config",
              field: "dataType",
              message: "field is immutable and cannot be updated",
            },
            {
              index: 1,
              namespace: "config",
              field: "allowMultiple",
              message: "field is immutable and cannot be updated",
            },
            {
              index: 2,
              namespace: "config",
              field: "unique",
              message: "field is immutable and cannot be updated",
            },
          ],
          "config",
        );
      });

      it("creates Field with dataType='plaintext'", () =>
        checkSuccess(
          [
            {
              type: fieldSystemType,
              key: "testStringField" as ConfigKey,
              dataType: "plaintext",
            },
          ],
          "config",
        ));

      it("creates Field with dataType='plaintext' and unique constraint", () =>
        checkSuccess(
          [
            {
              type: fieldSystemType,
              key: "testStringField2" as ConfigKey,
              dataType: "plaintext",
              unique: true,
            },
          ],
          "config",
        ));

      it("creates Type with fields using ObjTuple format", () =>
        checkSuccess(
          [
            {
              type: typeSystemType,
              key: "TestType" as ConfigKey,
              name: "Test Type",
              fields: [{ title: { required: true } }, "description"],
            },
          ],
          "config",
        ));
    });
  });
});
