import {
  assertCheck,
  assertDefined,
  assertEqual,
  assertFailed,
  assertNotEmpty,
  createError,
  err,
  isErr,
  type IsoTimestamp,
  ok,
  type ResultAsync,
  throwIfError,
} from "@binder/utils";
import { createUid, isValidUid } from "./utils/uid.ts";
import {
  applyChangeset as applyChangesetModel,
  type ChangesetsInput,
  emptyFieldset,
  type EntitiesChangeset,
  type EntityChangesetInput,
  type EntityId,
  type EntityNsRef,
  type EntityNsUid,
  type EntityUid,
  type FieldChangeset,
  type FieldKey,
  incrementEntityId,
  isEntityUpdate,
  isListMutation,
  isListMutationArray,
  type NamespaceEditable,
} from "./model";
import type { DbTransaction } from "./db.ts";
import {
  createEntity,
  deleteEntity,
  fetchEntityFieldset,
  updateEntity,
} from "./entity-store.ts";

const systemGeneratedFields = [
  "id",
  "version",
  "createdAt",
  "updatedAt",
] as const;

export const applyChangeset = async <N extends NamespaceEditable>(
  tx: DbTransaction,
  namespace: N,
  entityUid: EntityNsUid[N],
  changeset: FieldChangeset,
): ResultAsync<void> => {
  if (Object.keys(changeset).length === 0) return ok(undefined);

  if ("createdAt" in changeset) {
    const createdAtChange = changeset.createdAt;
    assertEqual(createdAtChange.op, "set", "changeset.createdAt.op");

    if (createdAtChange.op === "set") {
      if (createdAtChange.previous === undefined) {
        assertDefined(changeset.type, "changeset.type");
        const patch = applyChangesetModel(emptyFieldset, changeset);
        return await createEntity(tx, namespace, { ...patch, uid: entityUid });
      }
      if (createdAtChange.value === undefined) {
        return await deleteEntity(tx, namespace, entityUid);
      }
    }
    assertFailed("createdAt can not be updated");
  } else {
    const keys: FieldKey[] = Object.keys(changeset);
    const selectResult = await fetchEntityFieldset(
      tx,
      namespace,
      entityUid,
      keys,
    );
    if (isErr(selectResult)) return selectResult;

    const currentValues = selectResult.data;
    const patch = applyChangesetModel(currentValues, changeset);
    return await updateEntity(tx, namespace, entityUid, patch);
  }
};

export const processChangesetInput = async <N extends NamespaceEditable>(
  tx: DbTransaction,
  namespace: N,
  input: ChangesetsInput<N>,
  txFields: {
    updatedAt: IsoTimestamp;
    lastEntityId: EntityId;
  },
): ResultAsync<EntitiesChangeset<N>> => {
  let lastEntityId = txFields.lastEntityId;
  const buildChangeset = async (
    input: EntityChangesetInput<N>,
  ): ResultAsync<[EntityUid, FieldChangeset]> => {
    const updatedSystemField = systemGeneratedFields.find(
      (field) => field in input,
    );
    if (updatedSystemField)
      return err(
        createError(
          "invalid-input",
          `system field ${updatedSystemField} not allowed in update`,
        ),
      );

    if (isEntityUpdate(input)) {
      const ref = input.$ref as EntityNsRef[N];
      const keys = Object.keys(input).filter((k) => k !== "$ref") as FieldKey[];
      assertNotEmpty(keys);
      const selectResult = await fetchEntityFieldset(tx, namespace, ref, [
        ...keys,
        "uid",
        "version",
        "updatedAt",
      ]);
      if (isErr(selectResult)) return selectResult;
      const currentValues = selectResult.data;
      const changeset: FieldChangeset = {};
      changeset["version"] = {
        op: "set",
        previous: currentValues.version,
        value: (currentValues.version as number) + 1,
      };
      changeset["updatedAt"] = {
        op: "set",
        previous: currentValues.updatedAt,
        value: txFields.updatedAt,
      };
      for (const key of keys) {
        const currentValue = currentValues[key];
        const inputValue = input[key];
        if (isListMutationArray(inputValue)) {
          changeset[key] = { op: "sequence", mutations: inputValue };
        } else if (isListMutation(inputValue)) {
          changeset[key] = { op: "sequence", mutations: [inputValue] };
        } else {
          changeset[key] = {
            op: "set",
            value: inputValue,
            previous: currentValue,
          };
        }
      }
      return ok([currentValues.uid as EntityNsUid[N], changeset]);
    } else {
      const newEntityId = incrementEntityId(lastEntityId);
      lastEntityId = newEntityId;

      const entityData = {
        ...input,
        createdAt: txFields.updatedAt,
        updatedAt: txFields.updatedAt,
        version: 1,
        id: newEntityId,
      };

      const keys = Object.keys(entityData) as FieldKey[];
      const changeset: FieldChangeset = {};
      for (const key of keys) {
        changeset[key] = { op: "set", value: (entityData as any)[key] };
      }
      if (input["uid"]) {
        assertCheck(isValidUid(input["uid"]), "changeset uid input");
      }
      const uid = (input["uid"] ?? createUid()) as EntityUid;
      return ok([uid, changeset]);
    }
  };

  const changesetResults = await Promise.all(input.map(buildChangeset));
  const errorResults = changesetResults.filter((it) => isErr(it));
  if (errorResults.length > 0) {
    return err(
      createError(
        "changeset-input-process-failed",
        "failed creating changeset",
        { errors: errorResults.map((it) => it.error) },
      ),
    );
  }

  return ok(Object.fromEntries(changesetResults.map((it) => throwIfError(it))));
};
