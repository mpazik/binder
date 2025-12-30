import { describe, it, expect, beforeEach } from "bun:test";
import { isOk, throwIfError } from "@binder/utils";
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
  configurations:
    - key: email
      type: Field
      dataType: plaintext
- author: system
  configurations:
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
    expect(transactions[0].configurations).toMatchObject([
      { key: "email", type: "Field", dataType: "plaintext" },
    ]);
    expect(transactions[1]).toMatchObject({
      author: "system",
    });
    expect(transactions[1].configurations).toMatchObject([
      { key: "Person", type: "Type", name: "Person", fields: ["email"] },
    ]);
  });

  it("loadBlueprint uses default author when not specified", async () => {
    const blueprintContent = `
- configurations:
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
});
