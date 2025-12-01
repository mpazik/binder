import {
  assertDefinedPass,
  assertNotEmpty,
  type JsonObject,
  objectFromKeys,
  objKeys,
  ok,
  partition,
  pick,
  type ResultAsync,
  tryCatch,
} from "@binder/utils";
import { eq, inArray, or, type SQL, sql } from "drizzle-orm";
import {
  type EntityId,
  type EntityKey,
  type EntityRef,
  type EntityType,
  type EntityUid,
  type FieldKey,
  type Fieldset,
  GENESIS_ENTITY_ID,
  isEntityId,
  isEntityUid,
  type Namespace,
  type NamespaceEditable,
  type TransactionHash,
  type TransactionId,
} from "./model";
import type { DbTransaction } from "./db.ts";
import {
  editableEntityTables,
  entityTables,
  tableStoredFields,
} from "./schema.ts";

export type EntityDb = {
  id: EntityId;
  uid: EntityUid;
  key: EntityKey | null;
  type: EntityType;
  txIds: TransactionId[];
  fields: JsonObject;
};

const entityRefClause = <N extends Namespace>(
  namespace: N,
  ref: EntityRef,
): SQL => {
  if (isEntityId(ref)) return eq(entityTables[namespace].id, ref);
  if (namespace === "transaction")
    return eq(
      entityTables[namespace as "transaction"].hash,
      ref as TransactionHash,
    );

  const editableTable = entityTables[namespace as "config" | "node"];
  if (isEntityUid(ref)) {
    return eq(editableTable.uid, ref);
  }
  return eq(editableTable.key, ref as EntityKey);
};

export const entityToDbModel = (entity: Fieldset): EntityDb => {
  const keys = objKeys(entity);
  const [storedKeys, fieldKeys] = partition(keys, (key) =>
    tableStoredFields.includes(key),
  );

  return {
    ...pick(entity, storedKeys),
    fields: pick(entity, fieldKeys),
  } as EntityDb;
};

export const dbModelToEntity = (db: EntityDb): Fieldset => ({
  id: db.id,
  uid: db.uid,
  key: db.key,
  type: db.type,
  ...db.fields,
});

export const fetchEntityFieldset = async <N extends NamespaceEditable>(
  tx: DbTransaction,
  namespace: N,
  ref: EntityRef,
  keys: FieldKey[],
): ResultAsync<Fieldset> => {
  const table = editableEntityTables[namespace];
  return tryCatch(
    tx
      .select({
        ...objectFromKeys(
          keys.filter((key) => tableStoredFields.includes(key)),
          (key) => table[key as keyof typeof table],
        ),
        fields: table.fields,
      })
      .from(table)
      .where(entityRefClause(namespace, ref))
      .limit(1)
      .then((result) => {
        assertNotEmpty(result);
        const row = result[0];
        const parsedFields = row.fields as Fieldset;
        return objectFromKeys(keys, (key) => {
          if (tableStoredFields.includes(key)) {
            return row[key as keyof typeof row];
          }
          return parsedFields[key];
        }) as Fieldset;
      }),
  );
};

export const fetchEntity = async <N extends NamespaceEditable>(
  tx: DbTransaction,
  namespace: N,
  ref: EntityRef,
): ResultAsync<Fieldset> => {
  const table = editableEntityTables[namespace];
  return tryCatch(
    tx
      .select()
      .from(table)
      .where(entityRefClause(namespace, ref))
      .limit(1)
      .then((result) => {
        assertNotEmpty(result);
        return dbModelToEntity(result[0]);
      }),
  );
};

export const updateEntity = async <N extends NamespaceEditable>(
  tx: DbTransaction,
  namespace: N,
  ref: EntityRef,
  patch: Fieldset,
): ResultAsync<void> => {
  const table = editableEntityTables[namespace];
  const updateObj = entityToDbModel(patch);

  if (updateObj.fields) {
    updateObj.fields = sql.raw(
      `json_patch(fields, '${JSON.stringify(updateObj.fields)}')`,
    ) as any;
  }

  return tryCatch(
    async () =>
      await tx
        .update(table)
        .set(updateObj as any)
        .where(entityRefClause(namespace, ref)),
  );
};

export const createEntity = async <N extends NamespaceEditable>(
  tx: DbTransaction,
  namespace: N,
  patch: Fieldset,
): ResultAsync<void> => {
  return tryCatch(
    async () =>
      await tx
        .insert(editableEntityTables[namespace])
        .values(entityToDbModel(patch) as any),
  );
};

export const deleteEntity = async <N extends Namespace>(
  tx: DbTransaction,
  namespace: N,
  ref: EntityRef,
): ResultAsync<void> => {
  const table = entityTables[namespace];
  return tryCatch(
    async () => await tx.delete(table).where(entityRefClause(namespace, ref)),
  );
};

export const entityExists = async <N extends Namespace>(
  tx: DbTransaction,
  namespace: N,
  ref: EntityRef,
): ResultAsync<boolean> => {
  const table = entityTables[namespace];
  return tryCatch(
    tx
      .select({ id: table.id })
      .from(table)
      .where(entityRefClause(namespace, ref))
      .limit(1)
      .then((result) => result.length > 0),
  );
};

export const resolveEntityRefs = async (
  tx: DbTransaction,
  namespace: NamespaceEditable,
  refs: EntityRef[],
): ResultAsync<EntityUid[]> => {
  const entityUids = refs.filter(isEntityUid);
  if (entityUids.length === refs.length) return ok(entityUids);
  const entityIds = refs.filter(isEntityId);
  const entityKeys = refs.filter(
    (id) => !isEntityId(id) && !isEntityUid(id),
  ) as EntityKey[];

  const table = entityTables[namespace];
  return tryCatch(
    tx
      .select({
        id: table.id,
        key: table.key,
        uid: table.uid,
      })
      .from(table)
      .where(
        or(
          entityIds.length > 0
            ? inArray(entityTables[namespace].id, entityIds as any)
            : undefined,
          entityKeys.length > 0
            ? inArray(entityTables[namespace].key, entityKeys as any)
            : undefined,
        ),
      )
      .then((it) =>
        refs.map((ref): EntityUid => {
          if (isEntityId(ref))
            return assertDefinedPass(
              it.find((it) => it.id === ref),
              "id",
            ).uid;
          if (isEntityUid(ref)) return ref as EntityUid;
          return assertDefinedPass(
            it.find((it) => it.key === ref),
            "key",
          ).uid;
        }),
      ),
  );
};

export const getLastEntityId = async <N extends NamespaceEditable>(
  tx: DbTransaction,
  namespace: N,
): ResultAsync<EntityId> => {
  const table = editableEntityTables[namespace];
  return tryCatch(
    tx
      .select({ id: table.id })
      .from(table)
      .orderBy(sql`${table.id} DESC`)
      .limit(1)
      .then((result) => {
        if (result.length === 0) return GENESIS_ENTITY_ID;
        return result[0].id;
      }),
  );
};
