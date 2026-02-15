import { throwIfError } from "@binder/utils";
import { type Database, openDb } from "./db.ts";
import type { Fieldset } from "./model";
import { editableEntityTables } from "./schema.ts";
import { entityToDbModel } from "./entity-store.ts";

export const getTestDatabase = (): Database => {
  // possibly cache migrations in the future
  return throwIfError(openDb({ memory: true }));
};

export const insertRecord = async (db: Database, entity: Fieldset) => {
  await db.insert(editableEntityTables.record).values(entityToDbModel(entity));
};

export const insertConfig = async (db: Database, config: Fieldset) => {
  const dbModel = entityToDbModel(config);
  await db.insert(editableEntityTables.config).values({
    ...dbModel,
    key: dbModel.key!,
  });
};
