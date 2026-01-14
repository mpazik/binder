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
  mockProjectNode,
  mockProjectUid,
  mockTask1Node,
  mockTask2Node,
  mockTask2Uid,
  mockTask3Node,
  mockTask3Uid,
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
  type Fieldset,
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
  mockProjectFieldKey,
  mockProjectTypeKey,
  mockTasksFieldKey,
  mockTaskType,
  mockTaskTypeKey,
  mockTeamTypeKey,
  mockUserTypeKey,
} from "./model/config.mock.ts";
import { mockChangesetInputUpdateTask1 } from "./model/changeset-input.mock.ts";

const mockTask1FieldKeys = Object.keys(mockTask1Node) as FieldKey[];

describe("applyChangeset", () => {
  let db: Database;

  const apply = async (changeset: Parameters<typeof applyChangeset>[3]) => {
    await db.transaction(async (tx) => {
      throwIfError(
        await applyChangeset(tx, "node", mockTask1Node.uid, changeset),
      );
    });
  };

  const fetchTask1 = async () =>
    db.transaction(async (tx) =>
      throwIfError(
        await fetchEntityFieldset(
          tx,
          "node",
          mockTask1Node.uid,
          mockTask1FieldKeys,
        ),
      ),
    );

  beforeEach(() => {
    db = getTestDatabase();
  });

  it("applies and reverts changeset", async () => {
    await insertNode(db, mockTask1Node);

    await apply(mockChangesetUpdateTask1);
    expect(await fetchTask1()).toEqual(mockTaskNode1Updated);

    await apply(inverseChangeset(mockChangesetUpdateTask1));
    expect(await fetchTask1()).toEqual(mockTask1Node);
  });

  it("applies and reverts changeset for new node entity", async () => {
    await apply(mockChangesetCreateTask1);
    expect(await fetchTask1()).toEqual(mockTask1Node);

    await apply(inverseChangeset(mockChangesetCreateTask1));
    const exists = await db.transaction(async (tx) =>
      throwIfError(await entityExists(tx, "node", mockTask1Node.uid)),
    );
    expect(exists).toBe(false);
  });
});

describe("processChangesetInput", () => {
  let db: Database;
  const mockTask1LastEntityId = mockTask1Node.id;
  const invalidConfigType = "InvalidConfigType" as ConfigType;
  const testFieldKey = "testField" as ConfigKey;

  const process = async (
    inputs: EntityChangesetInput<NamespaceEditable>[],
    namespace: NamespaceEditable = "node",
  ): ResultAsync<EntitiesChangeset<NamespaceEditable>> => {
    const schema = namespace === "config" ? coreConfigSchema : mockNodeSchema;
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
        await createEntity(tx, "node", entity);
      }
      await saveTransaction(tx, mockTransactionInit);
    });
  };

  beforeEach(() => {
    db = getTestDatabase();
  });

  describe("create", () => {
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
      input: EntityChangesetInput<"node">,
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
          { type: mockTaskTypeKey, title: "Pending Task", status: "pending" },
        ]),
      );
      expect(Object.values(result)[0]).not.toHaveProperty("completedAt");
    });

    it("applies default when 'when' condition is met", () =>
      check(
        { type: mockTaskTypeKey, title: "Complete Task", status: "complete" },
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

    it("rejects Field with default not matching dataType", async () => {
      await checkErrors(
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
      await checkErrors(
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
      );
    });

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

    it("rejects Field with option default not in options list", async () => {
      await checkErrors(
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

  describe("validation", () => {
    it("rejects create with invalid node type", () =>
      expectError([{ type: mockNotExistingNodeTypeKey, name: "Test Item" }], {
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
      await expectError(
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
      await checkErrors(
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
      checkSuccess([
        { type: mockTaskTypeKey, title: "Task", status: "pending" },
      ]));

    it("rejects create missing conditional required field when condition is met", async () => {
      await checkErrors(
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
      checkSuccess([
        {
          type: mockTaskTypeKey,
          title: "Cancelled Task",
          status: "cancelled",
          cancelReason: "No longer needed",
        },
      ]));

    it("rejects update to status triggering conditional required field", async () => {
      await insertNode(db, mockTask1Node);

      await checkErrors(
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

      await checkSuccess([
        {
          $ref: mockTask1Node.uid,
          status: "cancelled",
          cancelReason: "Project cancelled",
        },
      ]);
    });

    it("rejects create missing multiple mandatory properties", async () => {
      await checkErrors(
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
      await checkErrors(
        [
          { type: mockTaskTypeKey },
          { title: "Updated Task" } as unknown as EntityChangesetInput<"node">,
        ],
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
      await checkErrors(
        [
          {
            type: mockTaskTypeKey,
            title: "Test Task",
            invalidField: "test value",
          } as EntityChangesetInput<"node">,
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

    it("validates field data types", async () => {
      await checkErrors(
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
      );
    });

    it("normalizes single value to array for allowMultiple fields", async () => {
      const result = throwIfError(
        await process([
          {
            type: mockTaskTypeKey,
            title: "Test Task",
            tags: "single-tag" as unknown as string[],
          },
        ]),
      );
      expect(Object.values(result)[0]).toMatchObject({
        tags: ["single-tag"],
      });
    });

    it("validates option values against allowed options", async () => {
      await checkErrors(
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
      );
    });

    it("validates values in list mutations", async () => {
      await insertNode(db, mockTask1Node);

      await checkErrors(
        [
          {
            $ref: mockTask1Node.uid,
            tags: [
              ["insert", 123 as unknown as string, 0],
              ["remove", 456 as unknown as string, 1],
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

      await checkSuccess([
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

      await checkErrors(
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

    describe("patch", () => {
      it("validates patch attrs against field attributes", async () => {
        await insertNode(db, mockTaskWithOwnersNode);

        await checkErrors(
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

        await checkSuccess([
          {
            $ref: mockTaskWithOwnersNode.uid,
            owners: [["patch", "user-1", { role: "admin" }]],
          },
        ]);
      });

      it("ignores patch attrs not in field attributes", async () => {
        await insertNode(db, mockTaskWithOwnersNode);

        await checkSuccess([
          {
            $ref: mockTaskWithOwnersNode.uid,
            owners: [["patch", "user-1", { unknownAttr: "value" }]],
          },
        ]);
      });

      it("validates single patch mutation", async () => {
        await insertNode(db, mockTaskWithOwnersNode);

        await checkErrors(
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

    describe("inverseOf", () => {
      it("rejects inverseOf on single-value relation field", () =>
        checkErrors(
          [
            {
              type: fieldSystemType,
              key: "badInverseField" as ConfigKey,
              dataType: "relation",
              inverseOf: "parent",
            },
          ],
          [
            {
              index: 0,
              namespace: "config",
              field: "inverseOf",
              message:
                "inverseOf can only be used on allowMultiple relation fields (the 'many' side of a one-to-many relationship)",
            },
          ],
          "config",
        ));

      it("rejects inverseOf referencing non-existent field", () =>
        checkErrors(
          [
            {
              type: fieldSystemType,
              key: "badInverseField" as ConfigKey,
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
              key: "badInverseField" as ConfigKey,
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

      it("rejects inverseOf referencing allowMultiple relation field", () =>
        checkErrors(
          [
            {
              type: fieldSystemType,
              key: "badInverseField" as ConfigKey,
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
                'inverseOf must reference a single-value relation field, but "children" has allowMultiple',
            },
          ],
          "config",
        ));

      it("accepts valid inverseOf on allowMultiple relation field referencing single-value relation", () =>
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
    const mockUserKey = "user-rick" as NodeKey;
    const mockUserWithKey = { ...mockUserNode, key: mockUserKey };
    const mockTeamNode = {
      id: 100 as EntityId,
      uid: mockTaskWithOwnersUid,
      type: mockTeamTypeKey,
      members: [],
    };

    const check = async (
      inputs: EntityChangesetInput<"node">[],
      expectedField: string,
      expectedValue: NodeUid | NodeUid[],
    ) => {
      const result = throwIfError(await process(inputs));
      const nodeUids = Object.keys(result) as NodeUid[];
      const nodeChangeset = result[nodeUids[0]!];
      expect(nodeChangeset[expectedField]).toEqual(expectedValue);
    };

    it("resolves relation keys to UIDs in node changesets", async () => {
      await setup(mockProjectNode);
      await check(
        [{ type: mockTaskTypeKey, title: "Task", project: mockProjectKey }],
        "project",
        mockProjectNode.uid,
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
      await setup(mockUserWithKey, mockTeamNode);
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
      await setup(mockUserWithKey, mockTeamNode);
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

  describe("inverse relations", () => {
    const task2Unlinked = omit(mockTask2Node, ["project"]);
    const task3Unlinked = omit(mockTask3Node, ["project"]);
    const otherProjectUid = "projOther01" as NodeUid;
    const otherProject = {
      ...mockProjectNode,
      id: 10 as EntityId,
      uid: otherProjectUid,
      key: "other-project" as NodeKey,
      title: "Other Project",
    };

    const check = async (
      entities: Fieldset[],
      input: EntityChangesetInput<"node">,
      expected: EntitiesChangeset<"node">,
    ) => {
      await setup(...entities);
      const result = throwIfError(await process([input]));
      expect(result).toEqual(expected);
    };

    it("translates remove mutation on inverse field to direct field update", () =>
      check(
        [mockProjectNode, mockTask2Node],
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

    it("translates insert mutation on inverse field to direct field update", () =>
      check(
        [mockProjectNode, task2Unlinked],
        {
          $ref: mockProjectUid,
          [mockTasksFieldKey]: [["insert", mockTask2Uid]],
        },
        { [mockTask2Uid]: { [mockProjectFieldKey]: ["set", mockProjectUid] } },
      ));

    it("translates insert mutation when task already has different project", () =>
      check(
        [mockProjectNode, otherProject, mockTask2Node],
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
      check(
        [mockProjectNode, mockTask2Node, task3Unlinked],
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
          [mockTask3Uid]: { [mockProjectFieldKey]: ["set", mockProjectUid] },
        },
      ));

    it("strips inverse field from parent changeset while keeping other fields", async () => {
      await setup(mockProjectNode, task2Unlinked);
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
        title: ["set", "Updated Project Title", mockProjectNode.title],
      });
      expect(result[mockTask2Uid]).toEqual({
        [mockProjectFieldKey]: ["set", mockProjectUid],
      });
    });

    it("produces no parent changeset when only inverse field is updated", async () => {
      await setup(mockProjectNode, task2Unlinked);
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
        (uid) => result[uid as NodeUid] === projectChangeset,
      ) as NodeUid;

      expect(projectChangeset).toBeDefined();
      expect(projectChangeset![mockTasksFieldKey]).toBeUndefined();
      expect(result[mockTask2Uid]).toEqual({
        [mockProjectFieldKey]: ["set", projectUid],
      });
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
