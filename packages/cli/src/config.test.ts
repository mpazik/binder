import { describe, expect, it } from "bun:test";
import { AUTHOR, DB_PATH } from "./config.ts";

describe("config", () => {
  it("exports default configuration values", () => {
    expect(DB_PATH).toBe("./binder.db");
    expect(AUTHOR).toBe("cli-user");
  });
});
