import { isErr, notImplementedError, type ResultAsync } from "@binder/utils";
import type {
  ConfigRef,
  ConfigUid,
  Fieldset,
  GraphVersion,
  NodeRef,
  NodeUid,
  TransactionInput,
  TransactionRef,
} from "./model";
import type { Database } from "./db.ts";
import { fetchEntity, resolveEntityRefs } from "./entity-store.ts";
import { getVersion } from "./transaction-store.ts";
import {
  applyTransaction,
  processTransactionInput,
} from "./transaction-processor";

export type KnowledgeGraph = {
  fetchNode: (ref: NodeRef) => ResultAsync<Fieldset>;
  fetchConfig: (ref: ConfigRef) => ResultAsync<Fieldset>;
  version: () => ResultAsync<GraphVersion>;
  update: (input: TransactionInput) => ResultAsync<void>;
  rollback: (
    tx: TransactionRef,
    opt?: {
      maxDepth: number;
    },
  ) => ResultAsync<void>;
  revert: (
    tx: TransactionRef,
    opt?: {
      force: boolean;
      permanent: boolean;
    },
  ) => ResultAsync<void>;
};

export const openKnowledgeGraph = (db: Database): KnowledgeGraph => {
  return {
    fetchNode: async (ref: NodeRef) => {
      return db.transaction(async (tx) => {
        const resolvedRefs = await resolveEntityRefs(tx, "node", [ref]);
        if (isErr(resolvedRefs)) return resolvedRefs;
        const nodeUid = resolvedRefs.data[0] as NodeUid;

        return fetchEntity(tx, "node", nodeUid);
      });
    },
    fetchConfig: async (ref: ConfigRef) => {
      return db.transaction(async (tx) => {
        const resolvedRefs = await resolveEntityRefs(tx, "config", [ref]);
        if (isErr(resolvedRefs)) return resolvedRefs;
        const configUid = resolvedRefs.data[0] as ConfigUid;

        return fetchEntity(tx, "config", configUid);
      });
    },
    update: async (input: TransactionInput) => {
      return db.transaction(async (tx) => {
        const processedResult = await processTransactionInput(tx, input);
        if (isErr(processedResult)) return processedResult;

        return applyTransaction(tx, processedResult.data);
      });
    },
    version: async () => {
      return db.transaction(async (tx) => {
        return getVersion(tx);
      });
    },
    rollback: async (tx: TransactionRef, opt?) =>
      notImplementedError("rollback"),
    revert: async (tx: TransactionRef, opt?) => notImplementedError("revert"),
  };
};
