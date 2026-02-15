import { beforeEach, describe, expect, it } from "bun:test";
import { okVoid, throwIfError } from "@binder/utils";
import "@binder/utils/tests";
import { getTestDatabase } from "./db.mock";
import openKnowledgeGraph from "./knowledge-graph.ts";
import type { Database } from "./db.ts";
import { createEntity, fetchEntity, updateEntity } from "./entity-store.ts";
import {
  mockProjectRecord,
  mockTask1Key,
  mockTask1Record,
  mockTask1Uid,
  mockTask2Record,
  mockTask3Record,
  mockTaskRecord1Updated,
  mockUserRecord,
  NONEXISTENT_NODE_UID,
} from "./model/record.mock.ts";
import {
  mockTransactionInit,
  mockTransactionUpdate,
} from "./model/transaction.mock.ts";
import { mockTaskType, mockTaskTypeKey } from "./model/config.mock.ts";
import {
  type ConfigUid,
  coreFieldKeys,
  GENESIS_VERSION,
  type Transaction,
  versionFromTransaction,
} from "./model";
import { applyAndSaveTransaction } from "./transaction-processor.ts";
import { mockRecordSchemaRaw } from "./model/schema.mock.ts";
import {
  mockTransactionInitInput,
  mockTransactionInputUpdate,
} from "./model/transaction-input.mock.ts";

describe("knowledge graph", () => {
  let db: Database;
  let kg: ReturnType<typeof openKnowledgeGraph>;

  beforeEach(async () => {
    db = getTestDatabase();
    kg = openKnowledgeGraph(db);
  });

  describe("setup", () => {
    it("processes transaction input and fetches task records", async () => {
      const transaction = throwIfError(
        await kg.update(mockTransactionInitInput),
      );

      expect(Object.keys(transaction.records)).toEqual([
        mockProjectRecord.uid,
        mockTask1Record.uid,
        mockTask2Record.uid,
      ]);

      const taskResults = throwIfError(
        await kg.search({ filters: { type: "Task" } }),
      );
      expect(taskResults.items).toEqual([mockTask1Record, mockTask2Record]);
    });

    it("includes core fields in record schema", async () => {
      const schema = throwIfError(await kg.getRecordSchema());

      expect(Object.keys(schema.fields)).toEqual(coreFieldKeys);
    });
  });

  describe("with data", () => {
    beforeEach(async () => {
      await db.transaction(async (tx) => {
        throwIfError(await applyAndSaveTransaction(tx, mockTransactionInit));
      });
    });

    describe("fetchEntity", () => {
      beforeEach(async () => {
        await db.transaction(async (tx) => {
          await createEntity(tx, "record", mockProjectRecord);
          await createEntity(tx, "record", mockTask2Record);
          await createEntity(tx, "record", mockTask3Record);
        });
      });

      it("fetches record by id", async () => {
        const result = throwIfError(await kg.fetchEntity(mockTask1Record.id));

        expect(result).toEqual(mockTask1Record);
      });

      it("fetches record by uid", async () => {
        const result = throwIfError(await kg.fetchEntity(mockTask1Uid));

        expect(result).toEqual(mockTask1Record);
      });

      it("fetches record by key", async () => {
        const result = throwIfError(await kg.fetchEntity(mockTask1Key));

        expect(result).toEqual(mockTask1Record);
      });

      it("returns error when record doesn't exist", async () => {
        const result = await kg.fetchEntity(NONEXISTENT_NODE_UID);

        expect(result).toBeErr();
      });

      it("fetches record with relationship includes - returns uid without expansion", async () => {
        const result = throwIfError(
          await kg.fetchEntity(mockTask2Record.uid, {
            uid: true,
            project: true,
          }),
        );

        expect(result).toEqual({
          uid: mockTask2Record.uid,
          project: mockProjectRecord.uid,
        });
      });

      it("applies field selection with includes", async () => {
        const result = throwIfError(
          await kg.fetchEntity(mockTask2Record.uid, {
            title: true,
            project: { includes: { title: true } },
          }),
        );

        expect(result).toEqual({
          title: mockTask2Record.title,
          project: { title: mockProjectRecord.title },
        });
      });

      it("applies field selection with two levels of nested includes", async () => {
        await db.transaction(async (tx) => {
          await createEntity(tx, "record", mockUserRecord);
          await updateEntity(tx, "record", mockTask2Record.uid, {
            assignedTo: mockUserRecord.uid,
          });
        });

        const result = throwIfError(
          await kg.fetchEntity(mockProjectRecord.uid, {
            title: true,
            tasks: {
              filters: { uid: mockTask2Record.uid },
              includes: {
                title: true,
                assignedTo: { uid: true, name: true },
              },
            },
          }),
        );

        expect(result).toEqual({
          title: mockProjectRecord.title,
          tasks: [
            {
              title: mockTask2Record.title,
              assignedTo: {
                uid: mockUserRecord.uid,
                name: mockUserRecord.name,
              },
            },
          ],
        });
      });

      it("fetches config by uid", async () => {
        const result = throwIfError(
          await kg.fetchEntity(mockTaskType.uid, undefined, "config"),
        );

        expect(result).toEqual(mockTaskType);
      });

      it("fetches config by key", async () => {
        const result = throwIfError(
          await kg.fetchEntity(mockTaskTypeKey as any, undefined, "config"),
        );

        expect(result).toEqual(mockTaskType);
      });

      it("returns error when config doesn't exist", async () => {
        const result = await kg.fetchEntity(
          NONEXISTENT_NODE_UID as ConfigUid,
          undefined,
          "config",
        );

        expect(result).toBeErr();
      });
    });

    describe("update", () => {
      it("processes and applies transaction", async () => {
        let savedTransaction: Transaction | undefined;
        const kgWithCallback = openKnowledgeGraph(db, {
          callbacks: {
            beforeCommit: async (tx: Transaction) => {
              savedTransaction = tx;
              return okVoid;
            },
          },
        });

        const returnedTransaction = throwIfError(
          await kgWithCallback.update(mockTransactionInputUpdate),
        );
        expect(returnedTransaction).toEqual(mockTransactionUpdate);

        const updatedRecord = await db.transaction(async (tx) =>
          throwIfError(await fetchEntity(tx, "record", mockTask1Uid)),
        );

        expect(updatedRecord).toEqual(mockTaskRecord1Updated);
        expect(savedTransaction).toEqual(mockTransactionUpdate);
      });
    });

    describe("search", () => {
      beforeEach(async () => {
        await db.transaction(async (tx) => {
          const { mockTask2Record, mockTask3Record, mockProjectRecord } =
            await import("./model/record.mock.ts");
          await createEntity(tx, "record", mockProjectRecord);
          await createEntity(tx, "record", mockTask2Record);
          await createEntity(tx, "record", mockTask3Record);
        });
      });

      it("returns all records without filters", async () => {
        const result = throwIfError(await kg.search({}));

        expect(result.items).toEqual([
          mockTask1Record,
          mockProjectRecord,
          mockTask2Record,
          mockTask3Record,
        ]);
        expect(result.pagination).toMatchObject({ hasNext: false });
      });

      it("filters by type", async () => {
        const result = throwIfError(
          await kg.search({
            filters: { type: "Task" },
          }),
        );

        expect(result.items).toEqual([
          mockTask1Record,
          mockTask2Record,
          mockTask3Record,
        ]);
      });

      it("filters by type using array shorthand", async () => {
        const result = throwIfError(
          await kg.search({
            filters: { type: ["Task", "Project"] },
          }),
        );

        expect(result.items).toEqual([
          mockTask1Record,
          mockProjectRecord,
          mockTask2Record,
          mockTask3Record,
        ]);
      });

      it("respects pagination limit", async () => {
        const result = throwIfError(
          await kg.search({
            pagination: { limit: 2 },
          }),
        );

        expect(result.items).toEqual([mockTask1Record, mockProjectRecord]);
        expect(result.pagination).toMatchObject({ hasNext: true });
      });

      it("rejects filters with invalid field names", async () => {
        const result = await kg.search({
          filters: { InvalidField: "value" },
        });
        expect(result).toBeErrWithKey("invalid_filter_field");
      });

      it("searches config namespace when specified", async () => {
        const result = throwIfError(
          await kg.search(
            {
              filters: { type: "Type" },
            },
            "config",
          ),
        );

        const types = Object.keys(mockRecordSchemaRaw.types);
        expect(result.items.map((it) => it.key)).toEqual(types);
      });

      it("returns relation uid without expansion when includes is true", async () => {
        const result = throwIfError(
          await kg.search({
            filters: { type: "Task", key: mockTask2Record.key },
            includes: { project: true },
          }),
        );

        expect(result.items).toEqual([{ project: mockProjectRecord.uid }]);
      });

      it("expands relation with nested includes", async () => {
        const result = throwIfError(
          await kg.search({
            filters: { type: "Task", key: mockTask2Record.key },
            includes: { project: { uid: true, title: true } },
          }),
        );

        expect(result.items).toEqual([
          {
            project: {
              uid: mockProjectRecord.uid,
              title: mockProjectRecord.title,
            },
          },
        ]);
      });

      it("does not expand inverse relationship without nested includes", async () => {
        const { mockTasksFieldKey } = await import("./model/config.mock.ts");
        const result = throwIfError(
          await kg.search({
            filters: { type: "Project" },
            includes: { [mockTasksFieldKey]: true },
          }),
        );

        // Inverse relations without nested includes are not expanded
        expect(result.items).toEqual([{}]);
      });

      it("expands inverse relationship with nested includes", async () => {
        const { mockTasksFieldKey } = await import("./model/config.mock.ts");
        const result = throwIfError(
          await kg.search({
            filters: { type: "Project" },
            includes: { [mockTasksFieldKey]: { uid: true, title: true } },
          }),
        );

        expect(result.items).toEqual([
          {
            [mockTasksFieldKey]: [
              { uid: mockTask2Record.uid, title: mockTask2Record.title },
              { uid: mockTask3Record.uid, title: mockTask3Record.title },
            ],
          },
        ]);
      });

      it("applies field selection with includes", async () => {
        const result = throwIfError(
          await kg.search({
            filters: { type: "Task", key: mockTask2Record.key },
            includes: {
              title: true,
              project: { uid: true, title: true },
            },
          }),
        );

        expect(result.items).toEqual([
          {
            title: mockTask2Record.title,
            project: {
              uid: mockProjectRecord.uid,
              title: mockProjectRecord.title,
            },
          },
        ]);
      });

      it("applies field selection with two levels of nested includes", async () => {
        await db.transaction(async (tx) => {
          await createEntity(tx, "record", mockUserRecord);
          await updateEntity(tx, "record", mockTask2Record.uid, {
            assignedTo: mockUserRecord.uid,
          });
        });

        const result = throwIfError(
          await kg.search({
            filters: { type: "Project" },
            includes: {
              title: true,
              tasks: {
                filters: { uid: mockTask2Record.uid },
                includes: {
                  title: true,
                  assignedTo: { uid: true, name: true },
                },
              },
            },
          }),
        );

        expect(result.items).toEqual([
          {
            title: mockProjectRecord.title,
            tasks: [
              {
                title: mockTask2Record.title,
                assignedTo: {
                  uid: mockUserRecord.uid,
                  name: mockUserRecord.name,
                },
              },
            ],
          },
        ]);
      });
    });

    describe("rollback", () => {
      it("reverts changes", async () => {
        throwIfError(await kg.update(mockTransactionInputUpdate));
        const updatedRecord = throwIfError(await kg.fetchEntity(mockTask1Uid));
        expect(updatedRecord).toEqual(mockTaskRecord1Updated);

        throwIfError(await kg.rollback(1));

        const rolledBackRecord = throwIfError(
          await kg.fetchEntity(mockTask1Uid),
        );
        expect(rolledBackRecord).toEqual(mockTask1Record);
      });

      it("reverts changes with explicit version", async () => {
        throwIfError(await kg.update(mockTransactionInputUpdate));
        const version = throwIfError(await kg.version());
        const updatedRecord = throwIfError(await kg.fetchEntity(mockTask1Uid));
        expect(updatedRecord).toEqual(mockTaskRecord1Updated);

        throwIfError(await kg.rollback(1, version.id));

        const rolledBackRecord = throwIfError(
          await kg.fetchEntity(mockTask1Uid),
        );
        expect(rolledBackRecord).toEqual(mockTask1Record);
      });

      it("returns error when version mismatches", async () => {
        throwIfError(await kg.update(mockTransactionInputUpdate));

        const result = await kg.rollback(1, mockTransactionInit.id);

        expect(result).toBeErrWithKey("version-mismatch");
      });
    });
  });

  describe("version", () => {
    it("returns correct version for empty knowledge graph", async () => {
      const result = throwIfError(await kg.version());

      expect(result).toEqual(GENESIS_VERSION);
    });

    it("returns version before and after update", async () => {
      throwIfError(await kg.apply(mockTransactionInit));

      const result = throwIfError(await kg.version());
      expect(result).toEqual(versionFromTransaction(mockTransactionInit));

      throwIfError(await kg.update(mockTransactionInputUpdate));

      const updatedResult = throwIfError(await kg.version());
      expect(updatedResult).toEqual(
        versionFromTransaction(mockTransactionUpdate),
      );
    });
  });
});
