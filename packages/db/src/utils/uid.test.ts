import { describe, expect, it } from "bun:test";
import { createUid, isValidUid } from "./uid.ts";

describe("createUid", () => {
  const check = (
    byteLength: 4 | 6 | 8,
    charLength: number,
    prefix: string,
    expected?: RegExp,
  ) => {
    const result = createUid(byteLength, prefix) as string;

    if (expected) {
      expect(result).toMatch(expected);
    }

    expect(result.startsWith(`${prefix}_`)).toBe(true);
    const randomPart = result.slice(prefix.length + 1);
    expect(randomPart).toHaveLength(charLength);
    expect(randomPart).toMatch(/^[0-9A-Za-z_-]+$/);
  };

  it("generates uid with valid prefix and length", () => {
    check(8, 11, "test", /^test_[0-9A-Za-z_-]{11}$/);
    check(6, 8, "usr", /^usr_[0-9A-Za-z_-]{8}$/);
    check(4, 6, "x", /^x_[0-9A-Za-z_-]{6}$/);
  });

  it("generates different values on subsequent calls", () => {
    const uid1 = createUid(8, "test");
    const uid2 = createUid(8, "test");
    const uid3 = createUid(8, "test");

    expect(uid1).not.toBe(uid2);
    expect(uid2).not.toBe(uid3);
    expect(uid1).not.toBe(uid3);
  });

  it("generates uid with minimum length and prefix", () => {
    check(4, 6, "a", /^a_[0-9A-Za-z_-]{6}$/);
  });

  it("throws error for invalid length", () => {
    expect(() => createUid(0 as any, "test")).toThrow(
      "length of uuid is 0, expected to be greater than 3",
    );
    expect(() => createUid(-1 as any, "test")).toThrow(
      "length of uuid is -1, expected to be greater than 3",
    );
    expect(() => createUid(3 as any, "test")).toThrow(
      "length of uuid is 3, expected to be greater than 3",
    );
  });

  it("throws error for invalid prefix length", () => {
    expect(() => createUid(8, "")).toThrow(
      "length of prefix is 0, expected to be in range [1, 5]",
    );
    expect(() => createUid(8, "too-long")).toThrow(
      "length of prefix is 8, expected to be in range [1, 5]",
    );
  });

  it("throws error for invalid prefix characters", () => {
    expect(() => createUid(8, "123")).toThrow(
      "Prefix must contain only letters",
    );
    expect(() => createUid(8, "test-")).toThrow(
      "Prefix must contain only letters",
    );
    expect(() => createUid(8, "test_")).toThrow(
      "Prefix must contain only letters",
    );
    expect(() => createUid(8, "test!")).toThrow(
      "Prefix must contain only letters",
    );
  });
});

describe("isValidUid", () => {
  it("validates uid without prefix parameter", () => {
    const uid = createUid();
    expect(isValidUid(uid)).toBe(true);
    expect(isValidUid("rand-_Base6")).toBe(true);
    expect(isValidUid("r@ndomB@se6")).toBe(false);
    expect(isValidUid("short")).toBe(false);
  });

  it("validates uid with prefix parameter", () => {
    const uid = createUid(8, "test");
    expect(isValidUid(uid, "test", 8)).toBe(true);
    expect(isValidUid("test_abcd_f6Iijk", "test", 8)).toBe(true);
    expect(isValidUid(uid, "usr", 8)).toBe(false);
    expect(isValidUid(uid, "test", 6)).toBe(false);
  });

  it("validates uid with custom length", () => {
    const uid6 = createUid(6, "usr");
    const uid8 = createUid(8, "usr");
    expect(isValidUid(uid6, "usr", 6)).toBe(true);
    expect(isValidUid(uid8, "usr", 8)).toBe(true);
    expect(isValidUid(uid6, "usr", 8)).toBe(false);
  });

  it("returns false for invalid types", () => {
    expect(isValidUid(123)).toBe(false);
    expect(isValidUid(null)).toBe(false);
    expect(isValidUid(undefined)).toBe(false);
    expect(isValidUid({})).toBe(false);
  });
});
