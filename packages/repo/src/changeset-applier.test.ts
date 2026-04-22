import { beforeEach, describe, expect, it } from "bun:test";
import { throwIfError } from "@binder/utils";
import "@binder/utils/tests";
import {
  mockTask1Record,
  mockTaskRecord1Updated,
} from "./model/record.mock.ts";
import {
  mockChangesetCreateTask1,
  mockChangesetUpdateTask1,
} from "./model/changeset.mock.ts";
import { getTestDatabase, insertRecord } from "./db.mock.ts";
import { type Database } from "./db.ts";
import {
  applyChangeset,
  applyConfigChangesetToSchema,
} from "./changeset-applier";
import {
  type ConfigKey,
  emptySchema,
  type EntitiesChangeset,
  type FieldKey,
  type Fieldset,
  fieldSystemType,
  inverseChangeset,
  type RecordSchema,
  type RecordType,
  typeSystemType,
} from "./model";
import { entityExists, fetchEntityFieldset } from "./entity-store.ts";
import { mockRecordSchema } from "./model/schema.mock.ts";
import {
  mockPriorityField,
  mockPriorityFieldKey,
  mockTaskType,
  mockTaskTypeKey,
} from "./model/config.mock.ts";

describe("changeset applier", () => {
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

    const check = async (
      changeset: Parameters<typeof applyChangeset>[3],
      expected: Fieldset,
    ) => {
      await apply(changeset);
      expect(
        await db.transaction(async (tx) =>
          throwIfError(
            await fetchEntityFieldset(
              tx,
              "record",
              mockTask1Record.uid,
              mockTask1FieldKeys,
            ),
          ),
        ),
      ).toEqual(expected);
    };

    it("applies and reverts changeset", async () => {
      await insertRecord(db, mockTask1Record);
      await check(mockChangesetUpdateTask1, mockTaskRecord1Updated);
      await check(inverseChangeset(mockChangesetUpdateTask1), mockTask1Record);
    });

    it("applies and reverts changeset for new record entity", async () => {
      await check(mockChangesetCreateTask1, mockTask1Record);

      await apply(inverseChangeset(mockChangesetCreateTask1));
      const exists = await db.transaction(async (tx) =>
        throwIfError(await entityExists(tx, "record", mockTask1Record.uid)),
      );
      expect(exists).toBe(false);
    });
  });

  describe("applyConfigChangesetToSchema", () => {
    const newFieldKey = "priority" as ConfigKey;
    const newTypeKey = "Bug" as RecordType;

    const check = (
      changeset: EntitiesChangeset<"config">,
      expected: object,
      opts?: { schema?: RecordSchema },
    ) => {
      expect(
        applyConfigChangesetToSchema(opts?.schema ?? emptySchema(), changeset),
      ).toMatchObject(expected);
    };

    it("adds new field to schema", () => {
      check(
        {
          [newFieldKey]: {
            id: 1,
            uid: "_fldPriori0",
            key: newFieldKey,
            type: fieldSystemType,
            dataType: "plaintext",
          },
        },
        {
          fields: {
            [newFieldKey]: { key: newFieldKey, dataType: "plaintext" },
          },
        },
      );
    });

    it("adds new type to schema", () => {
      check(
        {
          [newTypeKey]: {
            id: 1,
            uid: "typBug0001",
            key: newTypeKey,
            type: typeSystemType,
            name: "Bug",
            fields: [[newFieldKey, { required: true }]],
          },
        },
        {
          types: {
            [newTypeKey]: {
              key: newTypeKey,
              name: "Bug",
              fields: [[newFieldKey, { required: true }]],
            },
          },
        },
      );
    });

    it("updates existing type fields", () => {
      check(
        {
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
        },
        {
          types: {
            [mockTaskTypeKey]: {
              fields: [
                [mockPriorityFieldKey, { required: true }],
                [newFieldKey, { required: true }],
              ],
            },
          },
        },
        { schema: mockRecordSchema },
      );
    });

    it("updates existing field properties", () => {
      check(
        {
          [mockPriorityFieldKey]: {
            description: [
              "set",
              "Updated description",
              mockPriorityField.description,
            ],
          },
        },
        {
          fields: {
            [mockPriorityFieldKey]: { description: "Updated description" },
          },
        },
        { schema: mockRecordSchema },
      );
    });

    it("removes field from schema", () => {
      check(
        { [mockPriorityFieldKey]: { id: ["clear", mockPriorityField.id] } },
        {
          fields: expect.not.objectContaining({
            [mockPriorityFieldKey]: expect.anything(),
          }),
        },
        { schema: mockRecordSchema },
      );
    });

    it("removes type from schema", () => {
      check(
        { [mockTaskTypeKey]: { id: ["clear", mockTaskType.id] } },
        {
          types: expect.not.objectContaining({
            [mockTaskTypeKey]: expect.anything(),
          }),
        },
        { schema: mockRecordSchema },
      );
    });
  });
});
