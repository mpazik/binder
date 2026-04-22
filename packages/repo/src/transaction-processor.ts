import { isErr, newIsoTimestamp, ok, type ResultAsync } from "@binder/utils";
import {
  type ChangesetsInput,
  type ConfigSchema,
  incrementEntityId,
  type RecordSchema,
  type Transaction,
  type TransactionInput,
  withHashTransaction,
} from "./model";
import type { DbTransaction } from "./db.ts";
import { processChangesetInput } from "./changeset-processor";
import { applyConfigChangesetToSchema } from "./changeset-applier.ts";
import { getVersion } from "./transaction-store";
import { getLastEntityId } from "./entity-store";

export const processTransactionInput = async (
  tx: DbTransaction,
  input: TransactionInput,
  recordSchema: RecordSchema,
  configSchema: ConfigSchema,
): ResultAsync<Transaction> => {
  const createdAt = input.createdAt ?? newIsoTimestamp();

  const [lastRecordIdResult, lastConfigIdResult, versionResult] =
    await Promise.all([
      getLastEntityId(tx, "record"),
      getLastEntityId(tx, "config"),
      getVersion(tx),
    ]);
  if (isErr(lastRecordIdResult)) return lastRecordIdResult;
  if (isErr(lastConfigIdResult)) return lastConfigIdResult;
  if (isErr(versionResult)) return versionResult;

  const configsResult = await processChangesetInput(
    tx,
    "config",
    (input.configs ?? []) as ChangesetsInput,
    configSchema,
    lastConfigIdResult.data,
  );

  if (isErr(configsResult)) return configsResult;
  const configs = configsResult.data;

  const updatedSchema = applyConfigChangesetToSchema(
    recordSchema,
    configsResult.data,
  );

  const recordsResult = await processChangesetInput(
    tx,
    "record",
    (input.records ?? []) as ChangesetsInput,
    updatedSchema,
    lastRecordIdResult.data,
  );
  if (isErr(recordsResult)) return recordsResult;

  return ok(
    await withHashTransaction(
      configSchema,
      updatedSchema,
      {
        previous: versionResult.data.hash,
        author: input.author ?? "",
        createdAt,
        records: recordsResult.data,
        configs: configs,
      },
      incrementEntityId(versionResult.data.id),
    ),
  );
};
