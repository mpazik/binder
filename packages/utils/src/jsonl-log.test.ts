import { beforeEach, describe, expect, it } from "bun:test";
import { type Result, throwIfError } from "./result.ts";
import "./tests/index.ts";
import { createInMemoryFileSystem } from "./filesystem.mock.ts";
import {
  appendLines,
  clearLog,
  readLineRange,
  readLines,
  readLinesFromEnd,
  readLastLines,
  removeLastLines,
} from "./jsonl-log.ts";

type Item = { id: number; value: string };
const items: Item[] = [
  { id: 1, value: "a" },
  { id: 2, value: "b" },
  { id: 3, value: "c" },
  { id: 4, value: "d" },
];

describe("jsonl-log", () => {
  let fs: ReturnType<typeof createInMemoryFileSystem>;
  const path = "/log.jsonl";

  beforeEach(async () => {
    fs = createInMemoryFileSystem();
    throwIfError(await fs.writeFile(path, ""));
    throwIfError(await appendLines(fs, path, items));
  });

  describe("appendLines", () => {
    it("writes one JSON line per item", async () => {
      expect(throwIfError(await fs.readFile(path))).toBe(
        items.map((i) => JSON.stringify(i)).join("\n") + "\n",
      );
    });

    it("uses a custom serializer when provided", async () => {
      throwIfError(await fs.writeFile(path, ""));
      throwIfError(await appendLines(fs, path, items, (i) => `#${i.id}`));
      expect(throwIfError(await fs.readFile(path))).toBe("#1\n#2\n#3\n#4\n");
    });
  });

  describe("readLastLines", () => {
    const check = async (count: number, expected: Item[]) => {
      expect(throwIfError(await readLastLines<Item>(fs, path, count))).toEqual(
        expected,
      );
    };

    it("returns empty array when file missing", async () => {
      expect(
        throwIfError(await readLastLines<Item>(fs, "/missing.jsonl", 5)),
      ).toEqual([]);
    });

    it("returns count 0 as empty", async () => {
      await check(0, []);
    });

    it("reads last N in oldest-first order", async () => {
      await check(1, [items[3]!]);
      await check(3, [items[1]!, items[2]!, items[3]!]);
    });

    it("returns all when count exceeds available", async () => {
      await check(10, items);
    });
  });

  describe("readLines", () => {
    const check = async (
      count: number,
      expected: Item[],
      opts?: { order?: "asc" | "desc"; filter?: (i: Item) => boolean },
    ) => {
      expect(
        throwIfError(await readLines<Item>(fs, path, count, opts)),
      ).toEqual(expected);
    };

    it("reads newest-first by default", async () => {
      await check(2, [items[3]!, items[2]!]);
    });

    it("reads oldest-first with asc", async () => {
      await check(2, [items[0]!, items[1]!], { order: "asc" });
    });

    it("applies filter before counting", async () => {
      await check(10, [items[1]!, items[3]!], {
        filter: (i) => i.id % 2 === 0,
        order: "asc",
      });
    });

    it("returns empty for count 0", async () => {
      await check(0, []);
    });
  });

  describe("readLineRange", () => {
    it("reads inclusive range by key", async () => {
      expect(
        throwIfError(
          await readLineRange<Item>(fs, path, {
            getKey: (i) => i.id,
            from: 2,
            to: 3,
          }),
        ),
      ).toEqual([items[1]!, items[2]!]);
    });

    it("reads from start when from omitted", async () => {
      expect(
        throwIfError(
          await readLineRange<Item>(fs, path, { getKey: (i) => i.id, to: 2 }),
        ),
      ).toEqual([items[0]!, items[1]!]);
    });
  });

  describe("readLinesFromEnd", () => {
    it("yields items newest-first", async () => {
      const seen: Item[] = [];
      for await (const result of readLinesFromEnd<Item>(fs, path)) {
        seen.push(throwIfError(result as Result<Item>));
      }
      expect(seen).toEqual([items[3]!, items[2]!, items[1]!, items[0]!]);
    });
  });

  describe("removeLastLines", () => {
    it("truncates the last N lines", async () => {
      throwIfError(await removeLastLines(fs, path, 1));
      expect(throwIfError(await readLastLines<Item>(fs, path, 10))).toEqual([
        items[0]!,
        items[1]!,
        items[2]!,
      ]);
    });

    it("errors when count exceeds available", async () => {
      expect(await removeLastLines(fs, path, 99)).toBeErr();
    });
  });

  describe("clearLog", () => {
    it("empties the file", async () => {
      throwIfError(await clearLog(fs, path));
      expect(throwIfError(await fs.readFile(path))).toBe("");
    });
  });
});
