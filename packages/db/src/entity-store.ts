import {
  assertDefinedPass,
  assertNotEmpty,
  errorToObject,
  type IsoTimestamp,
  type JsonObject,
  objectFromKeys,
  ok,
  partition,
  pick,
  type ResultAsync,
  tryCatch,
} from "@binder/utils";
import { eq, inArray, or, type SQL, sql } from "drizzle-orm";
import {
  type EntityKey,
  type EntityNsId,
  type EntityNsKey,
  type EntityNsRef,
  type EntityNsType,
  type EntityNsUid,
  type EntityRef,
  type EntityUid,
  type FieldKey,
  type Fieldset,
  isEntityId,
  isEntityUid,
  type Namespace,
  type NamespaceEditable,
  GENESIS_ENTITY_ID,
} from "./model";
import type { DbTransaction } from "./db.ts";
import {
  editableEntityTables,
  entityTables,
  tableStoredFields,
} from "./schema.ts";

export type EntityDb<N extends NamespaceEditable> = {
  id: EntityNsId[N];
  uid: EntityNsUid[N];
  key?: EntityNsKey[N];
  type: EntityNsType[N];
  version: number;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  deletedAt?: IsoTimestamp;
  fields: JsonObject;
};

const entityRefClause = <N extends Namespace>(
  namespace: N,
  ref: EntityNsRef[N],
): SQL => {
  if (isEntityId(ref)) return eq(entityTables[namespace].id, ref);
  if (namespace === "transaction")
    return eq(entityTables[namespace as "transaction"].hash, ref as any);

  const editableTable = entityTables[namespace as "config" | "node"];
  if (isEntityUid(ref)) {
    return eq(editableTable.uid, ref);
  }
  return eq(editableTable.key, ref as EntityNsKey["node" | "config"]);
};

export const entityToDbModel = <N extends NamespaceEditable>(
  entity: Fieldset,
): EntityDb<N> => {
  const keys = Object.keys(entity) as FieldKey[];
  const [storedKeys, fieldKeys] = partition(keys, (key) =>
    tableStoredFields.includes(key),
  );

  return {
    ...pick(entity, storedKeys),
    fields: pick(entity, fieldKeys),
  } as EntityDb<N>;
};

export const dbModelToEntity = (db: EntityDb<any>): Fieldset => {
  return {
    ...objectFromKeys(
      tableStoredFields,
      (key) => db[key as keyof EntityDb<any>],
    ),
    ...db.fields,
  };
};

export const fetchEntityFieldset = async <N extends NamespaceEditable>(
  tx: DbTransaction,
  namespace: N,
  ref: EntityNsRef[N],
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
    errorToObject,
  );
};

export const fetchEntity = async <N extends NamespaceEditable>(
  tx: DbTransaction,
  namespace: N,
  entityUid: EntityNsUid[N],
): ResultAsync<Fieldset> => {
  const table = editableEntityTables[namespace];
  return tryCatch(
    tx
      .select()
      .from(table)
      .where(eq(table.uid, entityUid))
      .limit(1)
      .then((result) => {
        assertNotEmpty(result);
        const row = result[0];
        return dbModelToEntity({
          ...row,
          deletedAt: row.deletedAt ?? undefined,
        });
      }),
    errorToObject,
  );
};

export const updateEntity = async <N extends NamespaceEditable>(
  tx: DbTransaction,
  namespace: N,
  entityUid: EntityNsUid[N],
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
        .where(eq(table.uid, entityUid)),
    errorToObject,
  );
};

export const createEntity = async <N extends NamespaceEditable>(
  tx: DbTransaction,
  namespace: N,
  patch: Fieldset & { uid: EntityNsUid[N] },
): ResultAsync<void> => {
  return tryCatch(
    async () =>
      await tx
        .insert(editableEntityTables[namespace])
        .values(entityToDbModel(patch) as any),
    errorToObject,
  );
};

export const deleteEntity = async <N extends Namespace>(
  tx: DbTransaction,
  namespace: N,
  ref: EntityNsRef[N],
): ResultAsync<void> => {
  const table = entityTables[namespace];
  return tryCatch(
    async () => await tx.delete(table).where(entityRefClause(namespace, ref)),
    errorToObject,
  );
};

export const entityExists = async <N extends Namespace>(
  tx: DbTransaction,
  namespace: N,
  ref: EntityNsRef[N],
): ResultAsync<boolean> => {
  const table = entityTables[namespace];
  return tryCatch(
    tx
      .select({ id: table.id })
      .from(table)
      .where(entityRefClause(namespace, ref))
      .limit(1)
      .then((result) => result.length > 0),
    errorToObject,
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
    errorToObject,
  );
};

export const getLastEntityId = async <N extends NamespaceEditable>(
  tx: DbTransaction,
  namespace: N,
): ResultAsync<EntityNsId[N]> => {
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
    errorToObject,
  ) as ResultAsync<EntityNsId[N]>;
};
