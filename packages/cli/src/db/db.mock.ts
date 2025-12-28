import { throwIfError } from "@binder/utils";
import { type DatabaseCli, openCliDb } from "./index.ts";

export const getTestDatabaseCli = (): DatabaseCli => {
  const { db } = throwIfError(openCliDb({ memory: true }));
  return db;
};
