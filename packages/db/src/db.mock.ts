import { throwIfError } from "@binder/utils";
import { openDb, type Database } from "./db.ts";

export const getTestDatabase = (): Database => {
  // possibly cache migrations in the future
  return throwIfError(openDb({ memory: true }));
};
