import { describe, it, expect } from "bun:test";
import { auctionMatch, type AuctionOptions } from "./auction-match.ts";

describe("auctionMatch", () => {
  const check = (
    scores: number[][],
    assignment: [number, number][],
    unassignedBidders: number[] = [],
    unassignedItems: number[] = [],
    options?: AuctionOptions,
  ) => {
    const result = auctionMatch(scores, options);
    expect(result).toEqual({
      assignment: new Map(assignment),
      unassignedBidders,
      unassignedItems,
    });
  };

  describe("optimal assignment", () => {
    it("greedy failure case: asymmetric backup options", () => {
      check(
        [
          [0.9, 0.1],
          [0.91, 0.89],
        ],
        [
          [0, 0],
          [1, 1],
        ],
      );
    });

    it("simple 2x2 with clear winner", () => {
      check(
        [
          [10, 1],
          [1, 10],
        ],
        [
          [0, 0],
          [1, 1],
        ],
      );
    });

    it("3x3 assignment", () => {
      check(
        [
          [5, 1, 1],
          [1, 5, 1],
          [1, 1, 5],
        ],
        [
          [0, 0],
          [1, 1],
          [2, 2],
        ],
      );
    });
  });

  describe("rectangular matrices", () => {
    it("more bidders than items", () => {
      check(
        [
          [10, 1],
          [1, 10],
          [5, 5],
        ],
        [
          [0, 0],
          [1, 1],
        ],
        [2],
      );
    });

    it("more items than bidders", () => {
      check(
        [
          [10, 1, 5],
          [1, 10, 5],
        ],
        [
          [0, 0],
          [1, 1],
        ],
        [],
        [2],
      );
    });
  });

  describe("threshold filtering", () => {
    it("negative scores below default threshold remain unassigned", () => {
      check(
        [
          [-5, -10],
          [-10, -5],
        ],
        [],
        [0, 1],
        [0, 1],
      );
    });

    it("mixed positive and negative scores", () => {
      check(
        [
          [10, -5],
          [-5, -10],
        ],
        [[0, 0]],
        [1],
        [1],
      );
    });

    it("custom threshold filters low scores", () => {
      check(
        [
          [0.5, 0.1],
          [0.1, 0.5],
        ],
        [
          [0, 0],
          [1, 1],
        ],
        [],
        [],
        { threshold: 0.3 },
      );
    });

    it("high threshold rejects all", () => {
      check(
        [
          [0.5, 0.1],
          [0.1, 0.5],
        ],
        [],
        [0, 1],
        [0, 1],
        { threshold: 0.6 },
      );
    });
  });

  describe("edge cases", () => {
    it("empty bidders", () => {
      check([], []);
    });

    it("empty items", () => {
      check([[], []], [], [0, 1]);
    });

    it("single bidder single item", () => {
      check([[5]], [[0, 0]]);
    });

    it("single bidder single item below threshold", () => {
      check([[-5]], [], [0], [0]);
    });

    it("all equal scores", () => {
      check(
        [
          [5, 5],
          [5, 5],
        ],
        [
          [0, 0],
          [1, 1],
        ],
      );
    });
  });
});
