import { beforeEach, describe, expect, it } from "bun:test";
import {
  type ErrorObject,
  type ResultAsync,
  throwIfError,
  throwIfValue,
} from "@binder/utils";
import "@binder/utils/tests";
import {
  mockProjectKey,
  mockProjectNode,
  mockTask1Node,
  mockTaskNode1Updated,
  mockTaskWithOwnersNode,
  mockTaskWithOwnersUid,
  mockUserNode,
  mockUserUid,
} from "./model/node.mock.ts";
import {
  mockChangesetCreateTask1,
  mockChangesetUpdateTask1,
} from "./model/changeset.mock.ts";
import { getTestDatabase, insertConfig, insertNode } from "./db.mock.ts";
import { type Database } from "./db.ts";
import {
  applyChangeset,
  applyConfigChangesetToSchema,
  processChangesetInput,
} from "./changeset-processor";
import {
  type ConfigKey,
  type ConfigType,
  coreConfigSchema,
  emptySchema,
  type EntitiesChangeset,
  type EntityChangesetInput,
  type EntityId,
  type FieldKey,
  fieldSystemType,
  GENESIS_ENTITY_ID,
  inverseChangeset,
  type NamespaceEditable,
  type NodeKey,
  type NodeType,
  type NodeUid,
  typeSystemType,
} from "./model";
import {
  createEntity,
  entityExists,
  fetchEntityFieldset,
} from "./entity-store.ts";
import { saveTransaction } from "./transaction-store.ts";
import { mockTransactionInit } from "./model/transaction.mock.ts";
import { mockNodeSchema } from "./model/schema.mock.ts";
import {
  mockFieldKeyEmail,
  mockNotExistingNodeTypeKey,
  mockPriorityField,
  mockPriorityFieldKey,
  mockProjectTypeKey,
  mockTaskType,
  mockTaskTypeKey,
  mockTeamTypeKey,
  mockUserTypeKey,
} from "./model/config.mock.ts";
import { mockChangesetInputUpdateTask1 } from "./model/changeset-input.mock.ts";

const mockTask1FieldKeys = Object.keys(mockTask1Node) as FieldKey[];

describe("applyChangeset", () => {
  let db: Database;
  beforeEach(() => {
    db = getTestDatabase();
  });

  it("applies and reverts changeset", async () => {
    await insertNode(db, mockTask1Node);

    await db.transaction(async (tx) => {
      throwIfError(
        await applyChangeset(
          tx,
          "node",
          mockTask1Node.uid,
          mockChangesetUpdateTask1,
        ),
      );
    });

    const updatedEntity = await db.transaction(async (tx) =>
      throwIfError(
        await fetchEntityFieldset(
          tx,
          "node",
          mockTask1Node.uid,
          mockTask1FieldKeys,
        ),
      ),
    );
    expect(updatedEntity).toEqual(mockTaskNode1Updated);

    await db.transaction(async (tx) => {
      throwIfError(
        await applyChangeset(
          tx,
          "node",
          mockTask1Node.uid,
          inverseChangeset(mockChangesetUpdateTask1),
        ),
      );
    });

    const revertedEntity = await db.transaction(async (tx) =>
      throwIfError(
        await fetchEntityFieldset(
          tx,
          "node",
          mockTask1Node.uid,
          mockTask1FieldKeys,
        ),
      ),
    );
    expect(revertedEntity).toEqual(mockTask1Node);
  });

  it("applies and reverts changeset for new node entity", async () => {
    await db.transaction(async (tx) => {
      throwIfError(
        await applyChangeset(
          tx,
          "node",
          mockTask1Node.uid,
          mockChangesetCreateTask1,
        ),
      );
    });

    const createdEntity = await db.transaction(async (tx) =>
      throwIfError(
        await fetchEntityFieldset(
          tx,
          "node",
          mockTask1Node.uid,
          mockTask1FieldKeys,
        ),
      ),
    );
    expect(createdEntity).toEqual(mockTask1Node);

    await db.transaction(async (tx) => {
      throwIfError(
        await applyChangeset(
          tx,
          "node",
          mockTask1Node.uid,
          inverseChangeset(mockChangesetCreateTask1),
        ),
      );
    });

    const existsAfterRevert = await db.transaction(async (tx) =>
      throwIfError(await entityExists(tx, "node", mockTask1Node.uid)),
    );
    expect(existsAfterRevert).toBe(false);
  });
});

describe("processChangesetInput", () => {
  let db: Database;
  const mockTask1LastEntityId = mockTask1Node.id;
  const invalidConfigType = "InvalidConfigType" as ConfigType;
  const testFieldKey = "testField" as ConfigKey;

  const process = async (
    inputs: EntityChangesetInput<any>[],
    namespace: NamespaceEditable = "node",
  ): ResultAsync<EntitiesChangeset<any>> => {
    const schema = namespace === "config" ? coreConfigSchema : mockNodeSchema;
    return await db.transaction(async (tx) =>
      processChangesetInput(tx, namespace, inputs, schema, GENESIS_ENTITY_ID),
    );
  };

  const checkHasError = async (
    inputs: EntityChangesetInput<any>[],
    expectedError: ErrorObject,
    namespace?: NamespaceEditable,
  ): Promise<ErrorObject> => {
    const result = await process(inputs, namespace);
    const error = throwIfValue(result);
    expect(error).toEqual(expectedError);
    return error;
  };

  const checkHasValidationErrors = async (
    inputs: EntityChangesetInput<any>[],
    expectedErrors: any[],
    namespace?: NamespaceEditable,
  ) => {
    const result = await process(inputs, namespace);
    expect(result).toBeErrWithKey("changeset-input-process-failed");
    const error = throwIfValue(result);
    expect((error.data as any).errors).toEqual(expectedErrors);
  };

  beforeEach(() => {
    db = getTestDatabase();
  });

  it("creates changeset for updated entity", async () => {
    await insertNode(db, mockTask1Node);

    const result = await db.transaction(async (tx) =>
      throwIfError(
        await processChangesetInput(
          tx,
          "node",
          [mockChangesetInputUpdateTask1],
          mockNodeSchema,
          mockTask1LastEntityId,
        ),
      ),
    );

    expect(result).toEqual({
      [mockTask1Node.uid]: mockChangesetUpdateTask1,
    });
  });

  it("creates changeset for new config entity with uid field", async () => {
    const result = await db.transaction(async (tx) =>
      throwIfError(
        await processChangesetInput(
          tx,
          "config",
          [{ type: fieldSystemType, key: testFieldKey, dataType: "plaintext" }],
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

  it("includes field default values in changeset for new entity", async () => {
    const result = throwIfError(
      await process([
        { type: mockTaskTypeKey, title: "Task without priority" },
      ]),
    );

    const changeset = Object.values(result)[0];
    expect(changeset).toMatchObject({
      priority: "medium",
      status: "pending",
    });
  });

  it("includes type-level default over field-level default", async () => {
    const result = throwIfError(
      await process([{ type: mockProjectTypeKey, title: "Project" }]),
    );

    const changeset = Object.values(result)[0];
    expect(changeset).toMatchObject({
      status: "active",
    });
  });

  it("does not override user-provided value with default", async () => {
    const result = throwIfError(
      await process([
        { type: mockTaskTypeKey, title: "Task", priority: "high" },
      ]),
    );

    const changeset = Object.values(result)[0];
    expect(changeset).toMatchObject({
      priority: "high",
    });
  });

  it("skips default when 'when' condition is not met", async () => {
    const result = throwIfError(
      await process([
        { type: mockTaskTypeKey, title: "Pending Task", status: "pending" },
      ]),
    );

    const changeset = Object.values(result)[0];
    expect(changeset).not.toHaveProperty("completedAt");
  });

  it("applies default when 'when' condition is met", async () => {
    const result = throwIfError(
      await process([
        { type: mockTaskTypeKey, title: "Complete Task", status: "complete" },
      ]),
    );

    const changeset = Object.values(result)[0];
    expect(changeset).toMatchObject({
      completedAt: "2024-01-01T00:00:00.000Z",
    });
  });

  describe("validation", () => {
    const checkProcessingSucceeds = async (
      inputs: EntityChangesetInput<any>[],
      namespace?: NamespaceEditable,
    ) => {
      const result = await process(inputs, namespace);
      expect(result).toBeOk();
    };

    it("validates successful create changeset for node", () =>
      checkProcessingSucceeds([{ type: mockTaskTypeKey, title: "Test Task" }]));

    it("validates successful create changeset for config", () =>
      checkProcessingSucceeds(
        [{ type: fieldSystemType, key: testFieldKey, dataType: "plaintext" }],
        "config",
      ));

    it("rejects create with invalid node type", () =>
      checkHasError([{ type: mockNotExistingNodeTypeKey, name: "Test Item" }], {
        key: "changeset-input-process-failed",
        message: "failed creating changeset",
        data: {
          errors: [
            {
              index: 0,
              namespace: "node",
              field: "type",
              message: "invalid type: NotExistingNodeType",
            },
          ],
        },
      }));

    it("rejects create with invalid config type", async () => {
      await checkHasError(
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
      );
    });

    it("rejects create missing mandatory property", async () => {
      await checkHasValidationErrors(
        [{ type: mockTaskTypeKey }],
        [
          {
            index: 0,
            namespace: "node",
            field: "title",
            message: "mandatory property is missing or null",
          },
        ],
      );
    });

    it("accepts create without conditional required field when condition not met", () =>
      checkProcessingSucceeds([
        { type: mockTaskTypeKey, title: "Task", status: "pending" },
      ]));

    it("rejects create missing conditional required field when condition is met", async () => {
      await checkHasValidationErrors(
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
            namespace: "node",
            field: "cancelReason",
            message: "mandatory property is missing or null",
          },
        ],
      );
    });

    it("accepts create with conditional required field when condition is met", () =>
      checkProcessingSucceeds([
        {
          type: mockTaskTypeKey,
          title: "Cancelled Task",
          status: "cancelled",
          cancelReason: "No longer needed",
        },
      ]));

    it("rejects update to status triggering conditional required field", async () => {
      await insertNode(db, mockTask1Node);

      await checkHasValidationErrors(
        [
          {
            $ref: mockTask1Node.uid,
            status: "cancelled",
          },
        ],
        [
          {
            index: 0,
            namespace: "node",
            field: "cancelReason",
            message: "mandatory property is missing or null",
          },
        ],
      );
    });

    it("accepts update to status with conditional required field provided", async () => {
      await insertNode(db, mockTask1Node);

      await checkProcessingSucceeds([
        {
          $ref: mockTask1Node.uid,
          status: "cancelled",
          cancelReason: "Project cancelled",
        },
      ]);
    });

    it("rejects create missing multiple mandatory properties", async () => {
      await checkHasValidationErrors(
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
      );
    });

    it("validates multiple changesets and reports all errors", async () => {
      await checkHasValidationErrors(
        [{ type: mockTaskTypeKey }, { title: "Updated Task" } as any],
        [
          {
            index: 0,
            namespace: "node",
            field: "title",
            message: "mandatory property is missing or null",
          },
          {
            index: 1,
            namespace: "node",
            field: "type",
            message: "type is required for create entity changeset",
          },
        ],
      );
    });

    it("rejects undefined fields in schema for create and update", async () => {
      await checkHasValidationErrors(
        [
          {
            type: mockTaskTypeKey,
            title: "Test Task",
            invalidField: "test value",
          } as any,
          { $ref: mockTask1Node.uid, anotherInvalidField: "test" },
        ],
        [
          {
            index: 0,
            namespace: "node",
            field: "invalidField",
            message: 'field "invalidField" is not defined in schema',
          },
          {
            index: 1,
            namespace: "node",
            field: "anotherInvalidField",
            message: 'field "anotherInvalidField" is not defined in schema',
          },
        ],
      );
    });

    it("rejects reserved keys on create and update", async () => {
      await insertConfig(db, mockPriorityField);

      await checkHasValidationErrors(
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

    it("validates field data types", async () => {
      await checkHasValidationErrors(
        [{ type: fieldSystemType, key: testFieldKey, dataType: 123 as any }],
        [
          {
            index: 0,
            namespace: "config",
            field: "dataType",
            message: "Expected non-empty string for option",
          },
        ],
        "config",
      );
    });

    it("validates allowMultiple fields", async () => {
      await checkHasValidationErrors(
        [
          {
            type: mockTaskTypeKey,
            title: "Test Task",
            tags: "single-tag" as any,
          },
        ],
        [
          {
            index: 0,
            namespace: "node",
            field: "tags",
            message: "Expected array when allowMultiple is true, got: string",
          },
        ],
      );
    });

    it("validates option values against allowed options", async () => {
      await checkHasValidationErrors(
        [
          {
            type: fieldSystemType,
            key: testFieldKey,
            dataType: "invalidDataType" as any,
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
      );
    });

    it("validates values in list mutations", async () => {
      await insertNode(db, mockTask1Node);

      await checkHasValidationErrors(
        [
          {
            $ref: mockTask1Node.uid,
            tags: [
              ["insert", 123 as any, 0],
              ["remove", 456 as any, 1],
            ],
          },
        ],
        [
          {
            index: 0,
            namespace: "node",
            field: "tags",
            message: expect.stringContaining("Invalid insert value"),
          },
          {
            index: 0,
            namespace: "node",
            field: "tags",
            message: expect.stringContaining("Invalid remove value"),
          },
        ],
      );
    });

    it("accepts valid list mutations", async () => {
      await insertNode(db, mockTask1Node);

      await checkProcessingSucceeds([
        {
          $ref: mockTask1Node.uid,
          tags: [
            ["insert", "urgent", 0],
            ["remove", "important", 1],
          ],
        },
      ]);
    });

    it("rejects duplicate unique field value", async () => {
      await insertNode(db, mockUserNode);

      await checkHasValidationErrors(
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
            namespace: "node",
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

      await checkHasValidationErrors(
        [
          {
            $ref: mockPriorityFieldKey,
            dataType: "integer",
          },
          {
            $ref: mockPriorityFieldKey,
            allowMultiple: true,
          },
          {
            $ref: mockPriorityFieldKey,
            unique: true,
          },
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
      checkProcessingSucceeds(
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
      checkProcessingSucceeds(
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
      checkProcessingSucceeds(
        [
          {
            type: typeSystemType,
            key: "TestType" as ConfigKey,
            name: "Test Type",
            fields: [{ title: { required: true } }, "description"] as any,
          },
        ],
        "config",
      ));

    describe("patch validation", () => {
      it("validates patch attrs against field attributes", async () => {
        await insertNode(db, mockTaskWithOwnersNode);

        await checkHasValidationErrors(
          [
            {
              $ref: mockTaskWithOwnersNode.uid,
              owners: [["patch", "user-1", { role: 123 }]],
            },
          ],
          [
            {
              index: 0,
              namespace: "node",
              field: "owners.role",
              message: "Expected string for plaintext, got: number",
            },
          ],
        );
      });

      it("accepts valid patch attrs", async () => {
        await insertNode(db, mockTaskWithOwnersNode);

        await checkProcessingSucceeds([
          {
            $ref: mockTaskWithOwnersNode.uid,
            owners: [["patch", "user-1", { role: "admin" }]],
          },
        ]);
      });

      it("ignores patch attrs not in field attributes", async () => {
        await insertNode(db, mockTaskWithOwnersNode);

        await checkProcessingSucceeds([
          {
            $ref: mockTaskWithOwnersNode.uid,
            owners: [["patch", "user-1", { unknownAttr: "value" }]],
          },
        ]);
      });

      it("validates single patch mutation", async () => {
        await insertNode(db, mockTaskWithOwnersNode);

        await checkHasValidationErrors(
          [
            {
              $ref: mockTaskWithOwnersNode.uid,
              owners: ["patch", "user-1", { role: false }],
            },
          ],
          [
            {
              index: 0,
              namespace: "node",
              field: "owners.role",
              message: "Expected string for plaintext, got: boolean",
            },
          ],
        );
      });
    });

    describe("default value validation", () => {
      it("accepts Field with valid default matching dataType", () =>
        checkProcessingSucceeds(
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
        checkProcessingSucceeds(
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
        checkProcessingSucceeds(
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

      it("rejects Field with default not matching dataType", async () => {
        await checkHasValidationErrors(
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
        );
      });

      it("rejects Type with field attr default not matching field dataType", async () => {
        await checkHasValidationErrors(
          [
            {
              type: typeSystemType,
              key: "TestTypeBadDefault" as ConfigKey,
              name: "Test Type",
              fields: [["title", { default: 123 }]] as any,
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
        );
      });

      it("accepts Field with option default matching valid option", () =>
        checkProcessingSucceeds(
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

      it("rejects Field with option default not in options list", async () => {
        await checkHasValidationErrors(
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
        );
      });
    });
  });

  describe("relation key resolution", () => {
    const mockUserKey = "user-rick" as NodeKey;
    const mockTeamNode = {
      id: 100 as EntityId,
      uid: mockTaskWithOwnersUid,
      type: mockTeamTypeKey,
      members: [],
    };

    const check = async (
      inputs: EntityChangesetInput<any>[],
      expectedField: string,
      expectedValue: NodeUid | NodeUid[],
    ) => {
      const result = throwIfError(await process(inputs));
      const nodeUids = Object.keys(result) as NodeUid[];
      const nodeChangeset = result[nodeUids[0]!];
      expect(nodeChangeset[expectedField]).toEqual(expectedValue);
    };

    it("resolves relation keys to UIDs in node changesets", async () => {
      await db.transaction(async (tx) => {
        await createEntity(tx, "node", mockProjectNode);
        await saveTransaction(tx, mockTransactionInit);
      });

      await check(
        [{ type: mockTaskTypeKey, title: "Task", project: mockProjectKey }],
        "project",
        mockProjectNode.uid,
      );
    });

    it("resolves relation keys to UIDs in array relation fields", async () => {
      await db.transaction(async (tx) => {
        await createEntity(tx, "node", { ...mockUserNode, key: mockUserKey });
        await saveTransaction(tx, mockTransactionInit);
      });

      await check(
        [{ type: mockTeamTypeKey, members: [mockUserKey] }],
        "members",
        [mockUserUid],
      );
    });

    it("resolves relation keys in list mutation insert", async () => {
      await db.transaction(async (tx) => {
        await createEntity(tx, "node", { ...mockUserNode, key: mockUserKey });
        await createEntity(tx, "node", mockTeamNode);
        await saveTransaction(tx, mockTransactionInit);
      });

      const result = throwIfError(
        await process([
          { $ref: mockTaskWithOwnersUid, members: [["insert", mockUserKey]] },
        ]),
      );

      expect(result[mockTaskWithOwnersUid].members).toEqual([
        "seq",
        [["insert", mockUserUid]],
      ]);
    });

    it("resolves relation keys in tuple format with attributes", async () => {
      await db.transaction(async (tx) => {
        await createEntity(tx, "node", { ...mockUserNode, key: mockUserKey });
        await createEntity(tx, "node", mockTeamNode);
        await saveTransaction(tx, mockTransactionInit);
      });

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
          { type: mockProjectTypeKey, key: mockProjectKey, title: "Project" },
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

      expect(teamChangeset!.members).toEqual([userChangeset!.uid as NodeUid]);
    });
  });
});

describe("applyConfigChangesetToSchema", () => {
  const newFieldKey = "priority" as ConfigKey;
  const newTypeKey = "Bug" as NodeType;

  it("adds new field to schema", () => {
    const changeset: EntitiesChangeset<"config"> = {
      [newFieldKey]: {
        id: 1,
        uid: "fldPriori01",
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

    const result = applyConfigChangesetToSchema(mockNodeSchema, changeset);

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

    const result = applyConfigChangesetToSchema(mockNodeSchema, changeset);

    expect(result.fields[mockPriorityFieldKey]?.description).toBe(
      "Updated description",
    );
  });
});
