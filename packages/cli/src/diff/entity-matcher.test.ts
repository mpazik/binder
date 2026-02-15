import { describe, it, expect } from "bun:test";
import { type FieldsetNested } from "@binder/db";
import {
  mockRecordSchema,
  mockProjectRecord,
  mockTask1Record,
  mockTask2Record,
} from "@binder/db/mocks";
import { omit } from "@binder/utils";
import { matchEntities } from "./entity-matcher.ts";
import { classifyFields } from "./field-classifier.ts";

describe("matchEntities", () => {
  const schema = mockRecordSchema;
  const classifications = classifyFields(schema);
  const config = { schema, classifications };

  const task1 = mockTask1Record as FieldsetNested;
  const task2 = mockTask2Record as FieldsetNested;
  const { uid: _, ...anonTask1 } = task1;
  const { uid: __, ...anonTask2 } = task2;

  const check = (
    newRecords: FieldsetNested[],
    oldRecords: FieldsetNested[],
    matches: [number, number][],
    toCreate: number[] = [],
    toRemove: number[] = [],
  ) => {
    const result = matchEntities(config, newRecords, oldRecords);
    expect(result).toEqual({
      matches: matches.map(([newIndex, oldIndex]) => ({ newIndex, oldIndex })),
      toCreate,
      toRemove,
    });
  };

  describe("UID matching", () => {
    it("matches records with identical UIDs", () => {
      check([task1], [task1], [[0, 0]]);
    });

    it("matches by UID despite content changes", () => {
      check(
        [{ ...task1, title: "Completely different title" }],
        [task1],
        [[0, 0]],
      );
    });

    it("matches multiple records by UID in different order", () => {
      check(
        [task1, task2],
        [task2, task1],
        [
          [0, 1],
          [1, 0],
        ],
      );
    });

    it("unknown UID becomes toCreate, old becomes toRemove", () => {
      check([{ ...task1, uid: "unknown-uid" }], [task1], [], [0], [0]);
    });
  });

  describe("similarity-based matching", () => {
    it("matches anonymous records by similarity", () => {
      check([anonTask1], [anonTask1], [[0, 0]]);
    });

    it("matches similar anonymous record over dissimilar one", () => {
      check(
        [{ ...anonTask1, title: "Implement user authentication v2" }],
        [anonTask1, anonTask2],
        [[0, 0]],
        [],
        [1],
      );
    });

    it("rejects match below threshold (negative score)", () => {
      const anonProject = omit(mockProjectRecord, ["uid"]);
      check([anonTask1], [anonProject], [], [0], [0]);
    });
  });

  describe("mixed UID and similarity", () => {
    it("UID matches first, remaining go to auction", () => {
      check(
        [task1, anonTask2],
        [task1, task2],
        [
          [0, 0],
          [1, 1],
        ],
      );
    });
  });

  describe("edge cases", () => {
    it("empty new records", () => {
      check([], [task1, task2], [], [], [0, 1]);
    });

    it("empty old records", () => {
      check([task1, task2], [], [], [0, 1], []);
    });

    it("both empty", () => {
      check([], [], []);
    });

    it("all UIDs match", () => {
      check(
        [task1, task2],
        [task1, task2],
        [
          [0, 0],
          [1, 1],
        ],
      );
    });

    it("no UIDs, all go to auction", () => {
      check(
        [anonTask1, anonTask2],
        [anonTask1, anonTask2],
        [
          [0, 0],
          [1, 1],
        ],
      );
    });
  });
});
