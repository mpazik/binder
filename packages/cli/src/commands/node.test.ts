import { beforeEach, describe, expect, it } from "bun:test";
import { throwIfError } from "@binder/utils";
import "@binder/utils/tests";
import { type Database, openKnowledgeGraph } from "@binder/db";
import {
  getTestDatabase,
  mockTask1Key,
  mockTask1Node,
  mockTransactionInitInput,
} from "@binder/db/mocks";
import { Log } from "../log.ts";
import * as ui from "../ui.ts";
import { nodeReadHandler } from "./node.ts";

describe("node commands", () => {
  let db: Database;
  let kg: ReturnType<typeof openKnowledgeGraph>;
  let printedData: unknown[] = [];

  const mockUi = {
    ...ui,
    printData: (data: unknown) => {
      printedData.push(data);
    },
  };

  beforeEach(async () => {
    db = getTestDatabase();
    kg = openKnowledgeGraph(db);
    printedData = [];

    throwIfError(await kg.update(mockTransactionInitInput));
  });

  describe("nodeReadHandler", () => {
    it("reads node by key", async () => {
      const result = await nodeReadHandler({
        kg,
        db,
        config: {
          author: "test-user",
          paths: {
            root: "/test",
            binder: "/test/.binder",
            docs: "/test/docs",
          },
          dynamicDirectories: [],
        },
        log: Log,
        ui: mockUi,
        args: { ref: mockTask1Key },
      });

      expect(result).toBeOk();
      expect(printedData).toEqual([expect.objectContaining(mockTask1Node)]);
    });
  });
});
