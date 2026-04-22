import { describe, expect, it } from "bun:test";
import { fail, throwIfError } from "@binder/utils";
import "@binder/utils/tests";
import { openDb } from "./db.ts";

describe("db", () => {
  it("migrates in-memory databases by default", () => {
    const db = throwIfError(openDb({ memory: true }));

    const tables = db.$client
      .query("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;

    expect(tables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "records" }),
        expect.objectContaining({ name: "configs" }),
        expect.objectContaining({ name: "transactions" }),
      ]),
    );

    db.$client.close();
  });

  it("skips migrations when disabled", () => {
    const db = throwIfError(openDb({ memory: true, migrate: false }));

    const tables = db.$client
      .query("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;

    expect(tables).toEqual([]);

    db.$client.close();
  });

  it("runs custom migration hook", () => {
    let called = false;

    const db = throwIfError(
      openDb({
        memory: true,
        migrate: {
          run: ({ migrateDefault }) => {
            called = true;
            return migrateDefault();
          },
        },
      }),
    );

    expect(called).toBe(true);
    db.$client.close();
  });

  it("propagates custom migration errors", () => {
    const result = openDb({
      memory: true,
      migrate: {
        run: () => fail("custom-migration-failed", "Custom migration failed"),
      },
    });

    expect(result).toBeErrWithKey("custom-migration-failed");
  });
});
