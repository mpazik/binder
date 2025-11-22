import { describe, expect, it } from "bun:test";
import { isScalar } from "yaml";
import {
  findYamlContext,
  getPositionContext,
  parseYamlDocument,
  positionToOffset,
  type Position,
} from "./yaml-cst.ts";

describe("yaml-cst", () => {
  const yamlText = `type: Task
title: My Task
description: This is a test
priority: high
tags:
  - work
  - important`;

  const { doc, lineCounter } = parseYamlDocument(yamlText);

  describe("findYamlContext", () => {
    const checkNode = (position: Position, expectedValue: unknown) => {
      const offset = positionToOffset(position, lineCounter);
      const result = findYamlContext(doc.contents!, offset);

      expect(result.node).toBeDefined();
      const { node } = result;

      expect(isScalar(node)).toBeTrue();
      if (isScalar(node)) {
        expect(node.value).toEqual(expectedValue);
      }
    };

    it("finds node at key position", () => {
      checkNode({ line: 0, character: 2 }, "type");
    });

    it("finds node at value position", () => {
      checkNode({ line: 0, character: 8 }, "Task");
    });
  });

  describe("getPositionContext", () => {
    const checkContext = (
      position: Position,
      expected: { type: string; fieldKey?: string },
    ) => {
      const context = getPositionContext(yamlText, position);
      expect(context).toMatchObject(expected);
    };

    it("detects key context", () => {
      checkContext({ line: 0, character: 2 }, { type: "key" });
    });

    it("detects value context with field key", () => {
      checkContext(
        { line: 0, character: 8 },
        { type: "value", fieldKey: "type" },
      );
    });

    it("detects value context for description field", () => {
      checkContext(
        { line: 2, character: 16 },
        { type: "value", fieldKey: "description" },
      );
    });

    it("detects value context after colon", () => {
      checkContext(
        { line: 0, character: 6 },
        { type: "value", fieldKey: "type" },
      );
    });

    it("detects value context in empty value position", () => {
      const emptyYaml = `type: 
status: pending`;
      const context = getPositionContext(emptyYaml, {
        line: 0,
        character: 6,
      });
      expect(context).toMatchObject({ type: "value", fieldKey: "type" });
    });
  });
});
