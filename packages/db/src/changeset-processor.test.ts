import { beforeEach, describe, expect, it } from "bun:test";
import {
  type ErrorObject,
  type ResultAsync,
  throwIfError,
  throwIfValue,
} from "@binder/utils";
import "@binder/utils/tests";
import {
  mockTask1Node,
  mockTaskNode1Updated,
  mockTaskWithOwnersNode,
  mockUserNode,
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
  emptyNodeSchema,
  type EntitiesChangeset,
  type EntityChangesetInput,
  type FieldKey,
  fieldSystemType,
  GENESIS_ENTITY_ID,
  inverseChangeset,
  type NamespaceEditable,
  type NodeType,
  stringFieldConfigType,
  typeSystemType,
} from "./model";
import { entityExists, fetchEntityFieldset } from "./entity-store.ts";
import { mockNodeSchema } from "./model/schema.mock.ts";
import {
  mockEmailFieldKey,
  mockNotExistingNodeTypeKey,
  mockTaskType,
  mockTaskTypeKey,
  mockTitleField,
  mockTitleFieldKey,
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
          [{ type: fieldSystemType, key: testFieldKey, dataType: "string" }],
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
      dataType: "string",
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
        [{ type: fieldSystemType, key: testFieldKey, dataType: "string" }],
        "config",
      ));

    it("rejects create with invalid node type", () =>
      checkHasError([{ type: mockNotExistingNodeTypeKey, name: "Test Item" }], {
        key: "changeset-input-process-failed",
        message: "failed creating changeset",
        data: {
          errors: [
            {
              changesetIndex: 0,
              namespace: "node",
              fieldKey: "type",
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
                changesetIndex: 0,
                namespace: "config",
                fieldKey: "type",
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
            changesetIndex: 0,
            namespace: "node",
            fieldKey: "title",
            message: "mandatory property is missing or null",
          },
        ],
      );
    });

    it("rejects create missing multiple mandatory properties", async () => {
      await checkHasValidationErrors(
        [{ type: fieldSystemType }],
        [
          {
            changesetIndex: 0,
            namespace: "config",
            fieldKey: "key",
            message: "mandatory property is missing or null",
          },
          {
            changesetIndex: 0,
            namespace: "config",
            fieldKey: "dataType",
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
            changesetIndex: 0,
            namespace: "node",
            fieldKey: "title",
            message: "mandatory property is missing or null",
          },
          {
            changesetIndex: 1,
            namespace: "node",
            fieldKey: "type",
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
            changesetIndex: 0,
            namespace: "node",
            fieldKey: "invalidField",
            message: 'field "invalidField" is not defined in schema',
          },
          {
            changesetIndex: 1,
            namespace: "node",
            fieldKey: "anotherInvalidField",
            message: 'field "anotherInvalidField" is not defined in schema',
          },
        ],
      );
    });

    it("rejects reserved keys on create and update", async () => {
      await insertConfig(db, mockTitleField);

      await checkHasValidationErrors(
        [
          {
            type: fieldSystemType,
            key: "first" as ConfigKey,
            dataType: "string",
          },
          { $ref: mockTitleFieldKey, key: "last" as ConfigKey },
        ],
        [
          {
            changesetIndex: 0,
            namespace: "config",
            fieldKey: "key",
            message: 'key "first" is reserved and cannot be used',
          },
          {
            changesetIndex: 1,
            namespace: "config",
            fieldKey: "key",
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
            changesetIndex: 0,
            namespace: "config",
            fieldKey: "dataType",
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
            changesetIndex: 0,
            namespace: "node",
            fieldKey: "tags",
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
            changesetIndex: 0,
            namespace: "config",
            fieldKey: "dataType",
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
            changesetIndex: 0,
            namespace: "node",
            fieldKey: "tags",
            message: expect.stringContaining("Invalid insert value"),
          },
          {
            changesetIndex: 0,
            namespace: "node",
            fieldKey: "tags",
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
            [mockEmailFieldKey]: "rick@example.com",
          },
        ],
        [
          {
            changesetIndex: 0,
            namespace: "node",
            fieldKey: mockEmailFieldKey,
            message: expect.stringContaining(
              "value must be unique, already exists",
            ),
          },
        ],
      );
    });

    it("rejects updates to immutable fields", async () => {
      await insertConfig(db, mockTitleField);

      await checkHasValidationErrors(
        [
          {
            $ref: mockTitleFieldKey,
            dataType: "integer",
          },
          {
            $ref: mockTitleFieldKey,
            allowMultiple: true,
          },
          {
            $ref: mockTitleFieldKey,
            unique: true,
          },
        ],
        [
          {
            changesetIndex: 0,
            namespace: "config",
            fieldKey: "dataType",
            message: "field is immutable and cannot be updated",
          },
          {
            changesetIndex: 1,
            namespace: "config",
            fieldKey: "allowMultiple",
            message: "field is immutable and cannot be updated",
          },
          {
            changesetIndex: 2,
            namespace: "config",
            fieldKey: "unique",
            message: "field is immutable and cannot be updated",
          },
        ],
        "config",
      );
    });

    it("auto-sets dataType to 'string' when creating StringField without specifying dataType", () =>
      checkProcessingSucceeds(
        [
          {
            type: stringFieldConfigType,
            key: "testStringField" as ConfigKey,
          },
        ],
        "config",
      ));

    it("accepts StringField with dataType='string'", () =>
      checkProcessingSucceeds(
        [
          {
            type: stringFieldConfigType,
            key: "testStringField2" as ConfigKey,
            dataType: "string",
          },
        ],
        "config",
      ));

    it("rejects StringField with dataType='relation'", async () => {
      await checkHasValidationErrors(
        [
          {
            type: stringFieldConfigType,
            key: "testStringField3" as ConfigKey,
            dataType: "relation",
          },
        ],
        [
          {
            changesetIndex: 0,
            namespace: "config",
            fieldKey: "dataType",
            message: 'field must have value "string", got: relation',
          },
        ],
        "config",
      );
    });

    it("creates Type with fields using ObjTuple format (YAML ergonomic input)", () =>
      checkProcessingSucceeds(
        [
          {
            type: typeSystemType,
            key: "TestType" as ConfigKey,
            name: "Test Type",
            // ObjTuple format: { fieldKey: { attrs } } instead of [fieldKey, { attrs }]
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
              changesetIndex: 0,
              namespace: "node",
              fieldKey: "owners.role",
              message: "Expected string, got: number",
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
              changesetIndex: 0,
              namespace: "node",
              fieldKey: "owners.role",
              message: "Expected string, got: boolean",
            },
          ],
        );
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
        dataType: "string",
      },
    };

    const result = applyConfigChangesetToSchema(emptyNodeSchema, changeset);

    expect(result.fields[newFieldKey]).toMatchObject({
      key: newFieldKey,
      dataType: "string",
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

    const result = applyConfigChangesetToSchema(emptyNodeSchema, changeset);

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
            [mockTitleFieldKey, { required: true }],
            [newFieldKey, { required: true }],
          ],
          mockTaskType.fields,
        ],
      },
    };

    const result = applyConfigChangesetToSchema(mockNodeSchema, changeset);

    expect(result.types[mockTaskTypeKey]?.fields).toEqual([
      [mockTitleFieldKey, { required: true }],
      [newFieldKey, { required: true }],
    ]);
  });

  it("updates existing field properties", () => {
    const changeset: EntitiesChangeset<"config"> = {
      [mockTitleFieldKey]: {
        description: ["set", "Updated description", mockTitleField.description],
      },
    };

    const result = applyConfigChangesetToSchema(mockNodeSchema, changeset);

    expect(result.fields[mockTitleFieldKey]?.description).toBe(
      "Updated description",
    );
  });
});
