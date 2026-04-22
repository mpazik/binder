import { describe, it, expect, beforeEach } from "bun:test";
import { isOk, throwIfError } from "@binder/utils";
import type { EntityKey } from "@binder/repo";
import {
  createInMemoryFileSystem,
  type MockFileSystem,
} from "./filesystem.mock.ts";
import { createRealFileSystem } from "./filesystem.ts";
import { loadBlueprint, listBlueprints } from "./blueprint.ts";

describe("blueprint", () => {
  let fs: MockFileSystem;

  beforeEach(() => {
    fs = createInMemoryFileSystem();
  });

  it("loadBlueprint parses transactions from YAML", async () => {
    const blueprintContent = `
- author: system
  configs:
    - key: email
      type: Field
      dataType: plaintext
- author: system
  configs:
    - key: Person
      type: Type
      name: Person
      fields:
        - email
`;
    await fs.mkdir("/blueprints", { recursive: true });
    await fs.writeFile("/blueprints/personal.yaml", blueprintContent);

    const result = await loadBlueprint(
      fs,
      "/blueprints/personal.yaml",
      "test-author",
    );

    const transactions = throwIfError(result);
    expect(transactions[0]).toMatchObject({
      author: "system",
    });
    expect(transactions[0].configs).toMatchObject([
      { key: "email", type: "Field", dataType: "plaintext" },
    ]);
    expect(transactions[1]).toMatchObject({
      author: "system",
    });
    expect(transactions[1].configs).toMatchObject([
      { key: "Person", type: "Type", name: "Person", fields: ["email"] },
    ]);
  });

  it("loadBlueprint uses default author when not specified", async () => {
    const blueprintContent = `
- configs:
    - key: name
      type: Field
      dataType: plaintext
`;
    await fs.mkdir("/blueprints", { recursive: true });
    await fs.writeFile("/blueprints/test.yaml", blueprintContent);

    const result = await loadBlueprint(
      fs,
      "/blueprints/test.yaml",
      "default-author",
    );

    expect(isOk(result)).toBe(true);
    const transactions = throwIfError(result);
    expect(transactions[0].author).toBe("default-author");
  });

  it("loadBlueprint returns error for non-existent file", async () => {
    const result = await loadBlueprint(
      fs,
      "/blueprints/missing.yaml",
      "author",
    );

    expect(isOk(result)).toBe(false);
  });

  it("listBlueprints returns valid blueprints from data directory", async () => {
    const realFs = createRealFileSystem();
    const result = await listBlueprints(realFs);

    expect(isOk(result)).toBe(true);
    const blueprints = throwIfError(result);
    expect(blueprints.length).toBeGreaterThan(0);

    for (const bp of blueprints) {
      expect(bp.name).toBeDefined();
      expect(bp.types.length).toBeGreaterThan(0);
    }
  });

  it("default blueprint provides a Note type and sample notes", async () => {
    const realFs = createRealFileSystem();
    const blueprintsResult = await listBlueprints(realFs);
    const blueprints = throwIfError(blueprintsResult);

    const defaultBp = blueprints.find((bp) => bp.name === "Default");
    expect(defaultBp).toBeDefined();
    expect(defaultBp!.types).toEqual(["Note"] as EntityKey[]);

    const txResult = await loadBlueprint(realFs, defaultBp!.path, "system");
    const transactions = throwIfError(txResult);

    const records = transactions
      .flatMap((tx) => tx.records ?? [])
      .filter((r): r is Extract<typeof r, { type: unknown }> => "type" in r);
    expect(records.length).toBe(2);
    for (const r of records) expect(r.type).toBe("Note" as EntityKey);

    const keys = records.map((r) => r.key);
    expect(keys).toContain("welcome" as EntityKey);
    expect(keys).toContain("markdown-guide" as EntityKey);
  });
});
