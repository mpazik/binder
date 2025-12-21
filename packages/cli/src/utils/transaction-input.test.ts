import { describe, expect, it } from "bun:test";
import "@binder/utils/tests";
import {
  mockTransactionInit,
  mockTransactionUpdate,
  mockTransactionInitInput,
  mockTransactionInputUpdate,
} from "@binder/db/mocks";
import {
  detectFileFormat,
  parseTransactionInputContent,
  serializeTransactionInputs,
  transactionToInput,
} from "./transaction-input.ts";

describe("transaction-input utils", () => {
  describe("detectFileFormat", () => {
    it("detects yaml format", () => {
      expect(detectFileFormat("test.yaml")).toBe("yaml");
      expect(detectFileFormat("test.yml")).toBe("yaml");
    });

    it("detects jsonl format", () => {
      expect(detectFileFormat("test.jsonl")).toBe("jsonl");
    });

    it("defaults to json", () => {
      expect(detectFileFormat("test.json")).toBe("json");
      expect(detectFileFormat("test.txt")).toBe("json");
    });
  });

  describe("parseTransactionInputContent", () => {
    it("parses yaml content", () => {
      const yaml = `
- author: test
  nodes:
    - type: Task
      title: Test Task
`;
      const result = parseTransactionInputContent(yaml, "yaml", "default");
      expect(result).toBeOkWith([
        {
          author: "test",
          nodes: [{ type: "Task", title: "Test Task" }],
        },
      ]);
    });

    it("parses single yaml object as array", () => {
      const yaml = `
author: test
nodes:
  - type: Task
    title: Test Task
`;
      const result = parseTransactionInputContent(yaml, "yaml", "default");
      expect(result).toBeOkWith([
        {
          author: "test",
          nodes: [{ type: "Task", title: "Test Task" }],
        },
      ]);
    });

    it("parses json array", () => {
      const json = JSON.stringify([
        { author: "test", nodes: [{ type: "Task", title: "Test" }] },
      ]);
      const result = parseTransactionInputContent(json, "json", "default");
      expect(result).toBeOkWith([
        {
          author: "test",
          nodes: [{ type: "Task", title: "Test" }],
        },
      ]);
    });

    it("parses single json object as array", () => {
      const json = JSON.stringify({
        author: "test",
        nodes: [{ type: "Task", title: "Test" }],
      });
      const result = parseTransactionInputContent(json, "json", "default");
      expect(result).toBeOkWith([
        {
          author: "test",
          nodes: [{ type: "Task", title: "Test" }],
        },
      ]);
    });

    it("parses jsonl content", () => {
      const jsonl = `{"author":"test1","nodes":[{"type":"Task","title":"Task 1"}]}
{"author":"test2","nodes":[{"type":"Task","title":"Task 2"}]}`;
      const result = parseTransactionInputContent(jsonl, "jsonl", "default");
      expect(result).toBeOkWith([
        { author: "test1", nodes: [{ type: "Task", title: "Task 1" }] },
        { author: "test2", nodes: [{ type: "Task", title: "Task 2" }] },
      ]);
    });

    it("uses default author when not provided", () => {
      const yaml = `
- nodes:
    - type: Task
      title: Test
`;
      const result = parseTransactionInputContent(yaml, "yaml", "fallback");
      expect(result).toBeOkWith([
        {
          author: "fallback",
          nodes: [{ type: "Task", title: "Test" }],
        },
      ]);
    });

    it("returns error for invalid yaml", () => {
      const result = parseTransactionInputContent(
        "{ invalid yaml",
        "yaml",
        "default",
      );
      expect(result).toBeErr();
    });

    it("returns error for invalid json", () => {
      const result = parseTransactionInputContent(
        "{ invalid json",
        "json",
        "default",
      );
      expect(result).toBeErr();
    });
  });

  describe("serializeTransactionInputs", () => {
    const inputs = [mockTransactionInitInput, mockTransactionInputUpdate];

    it("serializes to jsonl", () => {
      const result = serializeTransactionInputs(inputs, "jsonl");
      const lines = result.split("\n");
      expect(lines).toEqual([
        expect.stringContaining('"author":"test-user"'),
        expect.stringContaining('"author":"test-user"'),
      ]);
    });

    it("serializes to json", () => {
      const result = serializeTransactionInputs(inputs, "json");
      const parsed = JSON.parse(result);
      expect(parsed).toEqual([
        expect.objectContaining({ author: "test-user" }),
        expect.objectContaining({ author: "test-user" }),
      ]);
    });

    it("serializes to yaml", () => {
      const result = serializeTransactionInputs(inputs, "yaml");
      expect(result).toContain("author: test-user");
    });

    it("omits empty nodes and configurations", () => {
      const result = serializeTransactionInputs(
        [{ author: "test", nodes: [], configurations: [] }],
        "json",
      );
      const parsed = JSON.parse(result);
      expect(parsed).toEqual([{ author: "test" }]);
    });
  });

  describe("transactionToInput", () => {
    it("converts create transaction to input format", () => {
      const input = transactionToInput(mockTransactionInit);
      expect(input.author).toBe(mockTransactionInit.author);
      expect(input.createdAt).toBe(mockTransactionInit.createdAt);
      expect(input.nodes).toBeDefined();
      expect(input.configurations).toBeDefined();
    });

    it("converts update transaction with $ref", () => {
      const input = transactionToInput(mockTransactionUpdate);
      expect(input.author).toBe(mockTransactionUpdate.author);
      expect(input.nodes).toBeDefined();
      expect(input.nodes![0]).toHaveProperty("$ref");
    });

    it("omits empty nodes and configurations", () => {
      const emptyTx = {
        ...mockTransactionUpdate,
        nodes: {},
        configurations: {},
      };
      const input = transactionToInput(emptyTx);
      expect(input.nodes).toBeUndefined();
      expect(input.configurations).toBeUndefined();
    });

    it("extracts new value from set changes", () => {
      const input = transactionToInput(mockTransactionUpdate);
      const nodeInput = input.nodes![0] as Record<string, unknown>;
      expect(nodeInput.title).toBe("Implement user authentication system");
    });

    it("strips id field from nodes", () => {
      const input = transactionToInput(mockTransactionInit);
      for (const node of input.nodes!) {
        expect(node).not.toHaveProperty("id");
      }
    });
  });
});
