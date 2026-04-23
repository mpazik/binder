import { throwIfError } from "@binder/utils";
import { type DatabaseCli, openMemoryCliDb } from "./index.ts";

export const getTestDatabaseCli = (): DatabaseCli => {
  const { db } = throwIfError(openMemoryCliDb());
  return db;
};
