import { describe, expect, it } from "bun:test";
import type { EntityKey, EntityUid } from "@binder/db";
import {
  mockEmailField,
  mockProjectField,
  mockTaskTypeKey,
} from "@binder/db/mocks";
import type { CursorContext, CursorEntityContext } from "../cursor-context.ts";
import { getEntityRef, type EntityStringRef } from "./definition.ts";

describe("getEntityRef", () => {
  const mockEntity: CursorEntityContext = {
    mapping: { status: "new", type: mockTaskTypeKey },
    entityIndex: 0,
  };

  const check = (
    cursorContext: Partial<CursorContext>,
    expected: EntityStringRef | undefined,
  ) => {
    const context = {
      documentType: "yaml",
      position: { line: 0, character: 0 },
      entity: mockEntity,
      ...cursorContext,
    } as CursorContext;
    expect(getEntityRef(context)).toEqual(expected);
  };

  it("returns undefined for field-key context", () => {
    check(
      {
        type: "field-key",
        fieldPath: ["email"],
        fieldDef: mockEmailField,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 5 },
        },
      },
      undefined,
    );
  });

  it("returns undefined for none context", () => {
    check({ type: "none" }, undefined);
  });

  it("returns undefined for non-relation field", () => {
    check(
      {
        type: "field-value",
        fieldPath: ["email"],
        fieldDef: mockEmailField,
        currentValue: "test@example.com",
      },
      undefined,
    );
  });

  it("returns undefined for relation field without value", () => {
    check(
      {
        type: "field-value",
        fieldPath: ["project"],
        fieldDef: mockProjectField,
        currentValue: undefined,
      },
      undefined,
    );
  });

  it("returns entity key for relation field", () => {
    check(
      {
        type: "field-value",
        fieldPath: ["project"],
        fieldDef: mockProjectField,
        currentValue: "my-project",
      },
      "my-project" as EntityKey,
    );
  });

  it("returns entity uid for relation field", () => {
    check(
      {
        type: "field-value",
        fieldPath: ["project"],
        fieldDef: mockProjectField,
        currentValue: "p_abc123",
      },
      "p_abc123" as EntityUid,
    );
  });
});
