import { throwIfError } from "@binder/utils";
import { type DatabaseCli, openCliDb } from "./index.ts";

export const getTestDatabaseCli = (): DatabaseCli => {
  return throwIfError(openCliDb({ memory: true }));
};
