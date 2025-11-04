import { beforeEach, describe, expect, it } from "bun:test";
import { throwIfError } from "@binder/utils";
import "@binder/utils/tests";
import {
  mockTask1Key,
  mockTask1Node,
  mockTransactionInitInput,
} from "@binder/db/mocks";
import {
  createMockCommandContextWithDb,
  mockUi as baseMockUi,
} from "../bootstrap.mock.ts";
import type { CommandContextWithDbWrite } from "../bootstrap.ts";
import { nodeReadHandler } from "./node.ts";

describe("node commands", () => {
  let context: CommandContextWithDbWrite;
  let printedData: unknown[] = [];

  beforeEach(async () => {
    printedData = [];
    context = {
      ...createMockCommandContextWithDb(),
      ui: {
        ...baseMockUi,
        printData: (data: unknown) => {
          printedData.push(data);
        },
      },
    };

    throwIfError(await context.kg.update(mockTransactionInitInput));
  });

  describe("nodeReadHandler", () => {
    it("reads node by key", async () => {
      const result = await nodeReadHandler({
        ...context,
        args: { ref: mockTask1Key },
      });

      expect(result).toBeOk();
      expect(printedData).toEqual([expect.objectContaining(mockTask1Node)]);
    });
  });
});
