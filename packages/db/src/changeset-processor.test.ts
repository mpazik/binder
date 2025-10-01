import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { throwIfError } from "@binder/utils";
import {
  mockTask2Node,
  mockTask1Node,
  mockTaskNode1Updated,
} from "./model/node.mock.ts";
import {
  mockChangesetCreateTask1,
  mockChangesetUpdateTask1,
  mockChangesetInputCreateTask1,
  mockChangesetInputUpdateTask1,
} from "./model/changeset.mock.ts";
import { getTestDatabase } from "./db.mock.ts";
import { type Database } from "./db.ts";
import { applyChangeset, processChangesetInput } from "./changeset-processor";
import { editableEntityTables } from "./schema.ts";
import { type FieldKey, GENESIS_ENTITY_ID, inverseChangeset } from "./model";
import {
  entityExists,
  entityToDbModel,
  fetchEntityFieldset,
} from "./entity-store.ts";

describe("applyChangeset", () => {
  let db: Database;
  beforeEach(() => {
    db = getTestDatabase();
  });

  it("applies and reverts changeset", async () => {
    const table = editableEntityTables["node"];
    await db.insert(table).values(entityToDbModel<"node">(mockTask1Node));

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
          Object.keys(mockTask1Node) as FieldKey[],
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
          Object.keys(mockTask1Node) as FieldKey[],
        ),
      ),
    );
    expect(revertedEntity).toEqual(mockTask1Node);
  });

  it("applies and reverts changeset for new entity", async () => {
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
          Object.keys(mockTask1Node) as FieldKey[],
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
      throwIfError(await entityExists(tx, "node", mockTask2Node.uid)),
    );
    expect(existsAfterRevert).toBe(false);
  });
});

describe("processChangesetInput", () => {
  let db: Database;
  beforeAll(() => {
    db = getTestDatabase();
  });

  it("creates changeset for updated entity", async () => {
    const table = editableEntityTables["node"];
    await db.insert(table).values(entityToDbModel<"node">(mockTask1Node));

    const result = await db.transaction(async (tx) =>
      throwIfError(
        await processChangesetInput(
          tx,
          "node",
          [mockChangesetInputUpdateTask1],
          {
            updatedAt: mockTaskNode1Updated.updatedAt,
            lastEntityId: mockTask1Node.id,
          },
        ),
      ),
    );

    expect(result).toEqual({
      [mockTask1Node.uid]: mockChangesetUpdateTask1,
    });
  });

  it("creates changeset for new entity", async () => {
    const result = await db.transaction(async (tx) =>
      throwIfError(
        await processChangesetInput(
          tx,
          "node",
          [mockChangesetInputCreateTask1],
          {
            updatedAt: mockTask1Node.updatedAt,
            lastEntityId: GENESIS_ENTITY_ID,
          },
        ),
      ),
    );

    expect(result).toEqual({
      [mockTask1Node.uid]: mockChangesetCreateTask1,
    });
  });
});
