import { beforeEach, describe, expect, it } from "bun:test";
import {
  type ErrorObject,
  omit,
  type ResultAsync,
  throwIfError,
  throwIfValue,
} from "@binder/utils";
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
  mockTaskRecord1Updated,
  mockTaskWithOwnersRecord,
  mockTaskWithOwnersUid,
  mockUser2Record,
  mockUser2Uid,
  mockUserRecord,
  mockUserUid,
} from "./model/record.mock.ts";
import {
  mockChangesetCreateTask1,
  mockChangesetUpdateTask1,
} from "./model/changeset.mock.ts";
import { getTestDatabase, insertConfig, insertRecord } from "./db.mock.ts";
import { type Database } from "./db.ts";
import {
  applyChangeset,
  applyConfigChangesetToSchema,
  processChangesetInput,
} from "./changeset-processor";
import {
  type ConfigKey,
  type ConfigType,
  type ConfigUid,
  coreConfigSchema,
  emptySchema,
  type EntitiesChangeset,
  type EntityChangesetInput,
  type EntityId,
  type FieldKey,
  type Fieldset,
  fieldSystemType,
  GENESIS_ENTITY_ID,
  inverseChangeset,
  mergeSchema,
  type NamespaceEditable,
  type RecordKey,
  type RecordType,
  type RecordUid,
  typeSystemType,
} from "./model";
import {
  createEntity,
  entityExists,
  fetchEntityFieldset,
} from "./entity-store.ts";
import { saveTransaction } from "./transaction-store.ts";
import { mockTransactionInit } from "./model/transaction.mock.ts";
import { mockRecordSchema } from "./model/schema.mock.ts";
import {
  mockFieldKeyEmail,
  mockNotExistingRecordTypeKey,
  mockPartnerFieldKey,
  mockPriorityField,
  mockPriorityFieldKey,
  mockProjectFieldKey,
  mockProjectTypeKey,
  mockRelatedToFieldKey,
  mockTasksFieldKey,
  mockTaskType,
  mockTaskTypeKey,
  mockTeamTypeKey,
  mockUserTypeKey,
} from "./model/config.mock.ts";
import { mockChangesetInputUpdateTask1 } from "./model/changeset-input.mock.ts";

describe("changeset processor", () => {
  let db: Database;

  beforeEach(() => {
    db = getTestDatabase();
  });

  describe("applyChangeset", () => {
    const mockTask1FieldKeys = Object.keys(mockTask1Record) as FieldKey[];

    const apply = async (changeset: Parameters<typeof applyChangeset>[3]) => {
      await db.transaction(async (tx) => {
        throwIfError(
          await applyChangeset(tx, "record", mockTask1Record.uid, changeset),
        );
      });
    };

    const fetchTask1 = async () =>
      db.transaction(async (tx) =>
        throwIfError(
          await fetchEntityFieldset(
            tx,
            "record",
            mockTask1Record.uid,
            mockTask1FieldKeys,
          ),
        ),
      );

    it("applies and reverts changeset", async () => {
      await insertRecord(db, mockTask1Record);

      await apply(mockChangesetUpdateTask1);
      expect(await fetchTask1()).toEqual(mockTaskRecord1Updated);

      await apply(inverseChangeset(mockChangesetUpdateTask1));
      expect(await fetchTask1()).toEqual(mockTask1Record);
    });

    it("applies and reverts changeset for new record entity", async () => {
      await apply(mockChangesetCreateTask1);
      expect(await fetchTask1()).toEqual(mockTask1Record);

      await apply(inverseChangeset(mockChangesetCreateTask1));
      const exists = await db.transaction(async (tx) =>
        throwIfError(await entityExists(tx, "record", mockTask1Record.uid)),
      );
      expect(exists).toBe(false);
    });
  });

  describe("processChangesetInput", () => {
    const mockTask1LastEntityId = mockTask1Record.id;
    const invalidConfigType = "InvalidConfigType" as ConfigType;
    const testFieldKey = "testField" as ConfigKey;

    const process = async (
      inputs: EntityChangesetInput<NamespaceEditable>[],
      namespace: NamespaceEditable = "record",
    ): ResultAsync<EntitiesChangeset<NamespaceEditable>> => {
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

    const setup = async (...entities: Fieldset[]) => {
      await db.transaction(async (tx) => {
        for (const entity of entities) {
          await createEntity(tx, "record", entity);
        }
        await saveTransaction(tx, mockTransactionInit);
      });
    };

    describe("create", () => {
      it("creates changeset for updated entity", async () => {
        await insertRecord(db, mockTask1Record);

        const result = await db.transaction(async (tx) =>
          throwIfError(
            await processChangesetInput(
              tx,
              "record",
              [mockChangesetInputUpdateTask1],
              mockRecordSchema,
              mockTask1LastEntityId,
            ),
          ),
        );

        expect(result).toEqual({
          [mockTask1Record.uid]: mockChangesetUpdateTask1,
        });
      });

      it("creates changeset for new config entity with uid field", async () => {
        const result = await db.transaction(async (tx) =>
          throwIfError(
            await processChangesetInput(
              tx,
              "config",
              [
                {
                  type: fieldSystemType,
                  key: testFieldKey,
                  dataType: "plaintext",
                },
              ],
              coreConfigSchema,
              GENESIS_ENTITY_ID,
            ),
          ),
        );

        const changeset = result[testFieldKey];
        expect(changeset).toMatchObject({
          uid: expect.any(String),
          key: testFieldKey,
          type: fieldSystemType,
          dataType: "plaintext",
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
              fields: [["title", { default: 123 }]],
            },
          ],
          [
            {
              index: 0,
              namespace: "config",
              field: "fields.title.default",
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
        await insertRecord(db, mockTask1Record);

        await checkErrors(
          [{ $ref: mockTask1Record.uid, status: "cancelled" }],
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
        await insertRecord(db, mockTask1Record);

        await checkSuccess([
          {
            $ref: mockTask1Record.uid,
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

      it("rejects undefined fields in schema for create and update", () =>
        checkErrors(
          [
            {
              type: mockTaskTypeKey,
              title: "Test Task",
              invalidField: "test value",
            } as EntityChangesetInput<"record">,
            { $ref: mockTask1Record.uid, anotherInvalidField: "test" },
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
        ));

      it("rejects reserved keys on create and update", async () => {
        await insertConfig(db, mockPriorityField);

        await checkErrors(
          [
            {
              type: fieldSystemType,
              key: "first" as ConfigKey,
              dataType: "plaintext",
            },
            { $ref: mockPriorityFieldKey, key: "last" as ConfigKey },
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
            { $ref: mockPriorityFieldKey, key: "0a1b2c3d4e5" as ConfigKey },
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

      it("validates values in list mutations", async () => {
        await insertRecord(db, mockTask1Record);

        await checkErrors(
          [
            {
              $ref: mockTask1Record.uid,
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
        await insertRecord(db, mockTask1Record);

        await checkSuccess([
          {
            $ref: mockTask1Record.uid,
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
            { $ref: mockPriorityFieldKey, dataType: "integer" },
            { $ref: mockPriorityFieldKey, allowMultiple: true },
            { $ref: mockPriorityFieldKey, unique: true },
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

      describe("normalization", () => {
        const checkNormalized = async (
          input: EntityChangesetInput<"record">,
          expected: Record<string, unknown>,
        ) => {
          const result = throwIfError(await process([input]));
          expect(Object.values(result)[0]).toMatchObject(expected);
        };

        it("normalizes single value to array for allowMultiple plaintext identifier field", () =>
          checkNormalized(
            { type: mockTaskTypeKey, title: "Test Task", tags: "single-tag" },
            { tags: ["single-tag"] },
          ));

        it("normalizes comma-separated string to array for allowMultiple plaintext identifier field", () =>
          checkNormalized(
            {
              type: mockTaskTypeKey,
              title: "Test Task",
              tags: "tag1, tag2, tag3",
            },
            { tags: ["tag1", "tag2", "tag3"] },
          ));

        it("preserves array values for allowMultiple fields", () =>
          checkNormalized(
            { type: mockTaskTypeKey, title: "Test Task", tags: ["a", "b"] },
            { tags: ["a", "b"] },
          ));

        it("filters empty items when splitting by delimiter", () =>
          checkNormalized(
            { type: mockTaskTypeKey, title: "Test Task", tags: "a,,b" },
            { tags: ["a", "b"] },
          ));

        it("does not split non-allowMultiple fields", () =>
          checkNormalized(
            { type: mockTaskTypeKey, title: "Title, with comma" },
            { title: "Title, with comma" },
          ));

        it("handles ObjTuple format in relation array field", async () => {
          await insertRecord(db, mockUserRecord);

          const result = throwIfError(
            await process([
              {
                type: mockTeamTypeKey,
                members: [{ [mockUserUid]: { role: "admin" } }],
              },
            ]),
          );

          expect(Object.values(result)[0]).toMatchObject({
            members: [[mockUserUid, { role: "admin" }]],
          });
        });
      });

      describe("patch", () => {
        it("validates patch attrs against field attributes", async () => {
          await insertRecord(db, mockTaskWithOwnersRecord);

          await checkErrors(
            [
              {
                $ref: mockTaskWithOwnersRecord.uid,
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
          await insertRecord(db, mockTaskWithOwnersRecord);

          await checkSuccess([
            {
              $ref: mockTaskWithOwnersRecord.uid,
              owners: [["patch", "user-1", { role: "admin" }]],
            },
          ]);
        });

        it("ignores patch attrs not in field attributes", async () => {
          await insertRecord(db, mockTaskWithOwnersRecord);

          await checkSuccess([
            {
              $ref: mockTaskWithOwnersRecord.uid,
              owners: [["patch", "user-1", { unknownAttr: "value" }]],
            },
          ]);
        });

        it("validates single patch mutation", async () => {
          await insertRecord(db, mockTaskWithOwnersRecord);

          await checkErrors(
            [
              {
                $ref: mockTaskWithOwnersRecord.uid,
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
                key: "oneToOneField" as ConfigKey,
                dataType: "relation",
                inverseOf: "parent",
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
                inverseOf: "title",
              },
            ],
            [
              {
                index: 0,
                namespace: "config",
                field: "inverseOf",
                message:
                  'inverseOf must reference a relation field, but "title" has dataType "plaintext"',
              },
            ],
            "config",
          ));

        it("rejects single-value inverseOf referencing allowMultiple field", () =>
          checkErrors(
            [
              {
                type: fieldSystemType,
                key: "badField" as ConfigKey,
                dataType: "relation",
                inverseOf: "children",
              },
            ],
            [
              {
                index: 0,
                namespace: "config",
                field: "inverseOf",
                message:
                  'inverseOf on a single-value field cannot reference an allowMultiple field "children". Place inverseOf on the allowMultiple side instead.',
              },
            ],
            "config",
          ));

        it("rejects inverseOf when target points to a different field", () =>
          checkErrors(
            [
              {
                type: fieldSystemType,
                key: "sideA" as ConfigKey,
                dataType: "relation",
                allowMultiple: true,
                inverseOf: "children",
              },
            ],
            [
              {
                index: 0,
                namespace: "config",
                field: "inverseOf",
                message:
                  'inverseOf target "children" has inverseOf="parent" which does not point back to "sideA"',
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
                key: "validInverseField" as ConfigKey,
                dataType: "relation",
                allowMultiple: true,
                inverseOf: "parent",
              },
            ],
            "config",
          ));
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
        expectedValue: RecordUid | RecordUid[],
      ) => {
        const result = throwIfError(await process(inputs));
        const recordUids = Object.keys(result) as RecordUid[];
        const recordChangeset = result[recordUids[0]!];
        expect(recordChangeset[expectedField]).toEqual(expectedValue);
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
        const result = throwIfError(
          await process([
            {
              $ref: mockTaskWithOwnersUid,
              members: [["insert", mockUserKey]],
            },
          ]),
        );
        expect(result[mockTaskWithOwnersUid].members).toEqual([
          "seq",
          [["insert", mockUserUid]],
        ]);
      });

      it("resolves relation keys in tuple format with attributes", async () => {
        await setup(mockUserWithKey, mockTeamRecord);
        const result = throwIfError(
          await process([
            {
              $ref: mockTaskWithOwnersUid,
              members: [["insert", [mockUserKey, { role: "admin" }]]],
            },
          ]),
        );
        expect(result[mockTaskWithOwnersUid].members).toEqual([
          "seq",
          [["insert", [mockUserUid, { role: "admin" }]]],
        ]);
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

        expect(teamChangeset!.members).toEqual([
          userChangeset!.uid as RecordUid,
        ]);
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
              $ref: mockProjectUid,
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
              $ref: mockProjectUid,
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
              $ref: otherProjectUid,
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
              $ref: mockProjectUid,
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
                $ref: mockProjectUid,
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
                $ref: mockProjectUid,
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

          const projectChangeset = Object.values(result).find(
            (cs) => cs.title === "New Project",
          );
          const projectUid = Object.keys(result).find(
            (uid) => result[uid as RecordUid] === projectChangeset,
          ) as RecordUid;

          expect(projectChangeset).toBeDefined();
          expect(projectChangeset![mockTasksFieldKey]).toBeUndefined();
          expect(result[mockTask2Uid]).toEqual({
            [mockProjectFieldKey]: ["set", projectUid],
          });
        });
      });

      describe("one-to-one", () => {
        const userWithPartner = {
          ...mockUserRecord,
          [mockPartnerFieldKey]: mockUser2Uid,
        } as Fieldset;
        const user2WithPartner = {
          ...mockUser2Record,
          [mockPartnerFieldKey]: mockUserUid,
        } as Fieldset;

        it("setting field generates inverse set on target", () =>
          checkInverseExpansion(
            [mockUserRecord, mockUser2Record],
            {
              $ref: mockUserUid,
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
              $ref: mockUserUid,
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
          const user3Uid = "_userBirdP0" as RecordUid;
          const user3Record = {
            ...mockUser2Record,
            id: 7 as EntityId,
            uid: user3Uid,
            name: "Birdperson",
          } as Fieldset;

          await setup(userWithPartner, user2WithPartner, user3Record);
          const result = throwIfError(
            await process([
              { $ref: mockUserUid, [mockPartnerFieldKey]: user3Uid },
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
              $ref: mockTask1Uid,
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
              $ref: mockTask1Uid,
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
              $ref: mockTask1Uid,
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
    });
  });

  describe("applyConfigChangesetToSchema", () => {
    const newFieldKey = "priority" as ConfigKey;
    const newTypeKey = "Bug" as RecordType;

    it("adds new field to schema", () => {
      const changeset: EntitiesChangeset<"config"> = {
        [newFieldKey]: {
          id: 1,
          uid: "_fldPriori0",
          key: newFieldKey,
          type: fieldSystemType,
          dataType: "plaintext",
        },
      };

      const result = applyConfigChangesetToSchema(emptySchema(), changeset);

      expect(result.fields[newFieldKey]).toMatchObject({
        key: newFieldKey,
        dataType: "plaintext",
      });
    });

    it("adds new type to schema", () => {
      const changeset: EntitiesChangeset<"config"> = {
        [newTypeKey]: {
          id: 1,
          uid: "typBug0001",
          key: newTypeKey,
          type: typeSystemType,
          name: "Bug",
          fields: [[newFieldKey, { required: true }]],
        },
      };

      const result = applyConfigChangesetToSchema(emptySchema(), changeset);

      expect(result.types[newTypeKey]).toMatchObject({
        key: newTypeKey,
        name: "Bug",
        fields: [[newFieldKey, { required: true }]],
      });
    });

    it("updates existing type fields", () => {
      const changeset: EntitiesChangeset<"config"> = {
        [mockTaskTypeKey]: {
          fields: [
            "set",
            [
              [mockPriorityFieldKey, { required: true }],
              [newFieldKey, { required: true }],
            ],
            mockTaskType.fields,
          ],
        },
      };

      const result = applyConfigChangesetToSchema(mockRecordSchema, changeset);

      expect(result.types[mockTaskTypeKey]?.fields).toEqual([
        [mockPriorityFieldKey, { required: true }],
        [newFieldKey, { required: true }],
      ]);
    });

    it("updates existing field properties", () => {
      const changeset: EntitiesChangeset<"config"> = {
        [mockPriorityFieldKey]: {
          description: [
            "set",
            "Updated description",
            mockPriorityField.description,
          ],
        },
      };

      const result = applyConfigChangesetToSchema(mockRecordSchema, changeset);

      expect(result.fields[mockPriorityFieldKey]?.description).toBe(
        "Updated description",
      );
    });
  });
});
