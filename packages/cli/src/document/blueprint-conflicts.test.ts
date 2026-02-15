import { join } from "path";
import { beforeEach, describe, expect, it } from "bun:test";
import { throwIfError } from "@binder/utils";
import "@binder/utils/tests";
import type { KnowledgeGraph } from "@binder/db";
import { createMockRuntimeContextWithDb } from "../runtime.mock.ts";
import type { RuntimeContextWithDb } from "../runtime.ts";
import { loadBlueprint } from "../lib/blueprint.ts";
import { createRealFileSystem } from "../lib/filesystem.ts";
import { renderDocs } from "./repository.ts";
import { synchronizeModifiedFiles } from "./synchronizer.ts";

/**
 * Integration tests that bootstrap from the project blueprint,
 * render documents, then modify them to trigger the three conflict
 * cases covered by the three-way field extraction spec.
 */
describe("blueprint conflict detection", () => {
  let ctx: RuntimeContextWithDb;
  let kg: KnowledgeGraph;

  beforeEach(async () => {
    ctx = await createMockRuntimeContextWithDb();
    kg = ctx.kg;

    const realFs = createRealFileSystem();
    const transactions = throwIfError(
      await loadBlueprint(
        realFs,
        join(__dirname, "../../data/blueprints/project.yaml"),
        "test",
      ),
    );
    for (const tx of transactions) {
      throwIfError(await kg.update(tx));
    }

    throwIfError(
      await renderDocs({
        db: ctx.db,
        kg,
        fs: ctx.fs,
        log: ctx.log,
        config: ctx.config,
        templates: ctx.templates,
      }),
    );
  });

  describe("Case 1: frontmatter + body overlap", () => {
    it("preserves body edit when frontmatter matches base", async () => {
      const filePath = join(ctx.config.paths.docs, "tasks/build-auth.md");
      const original = throwIfError(await ctx.fs.readFile(filePath));
      expect(original).toContain("**Status:** active");

      const modified = original.replace(
        "**Status:** active",
        "**Status:** complete",
      );
      throwIfError(await ctx.fs.writeFile(filePath, modified));

      const result = throwIfError(
        await synchronizeModifiedFiles(ctx, filePath),
      );
      expect(result).toMatchObject({
        records: [expect.objectContaining({ status: "complete" })],
      });
    });

    it("detects conflict when both frontmatter and body changed differently", async () => {
      const filePath = join(ctx.config.paths.docs, "tasks/build-auth.md");
      const original = throwIfError(await ctx.fs.readFile(filePath));

      const modified = original
        .replace("**Status:** active", "**Status:** complete")
        .replace("status: active", "status: cancelled");
      throwIfError(await ctx.fs.writeFile(filePath, modified));

      const result = await synchronizeModifiedFiles(ctx, filePath);
      expect(result).toBeErrWithKey("field-conflict");
    });
  });

  describe("Case 2: duplicate field slot in template", () => {
    it("syncs when duplicate slots have same value", async () => {
      const filePath = join(ctx.config.paths.docs, "summaries/build-auth.md");
      const original = throwIfError(await ctx.fs.readFile(filePath));

      const modified = original
        .replace("# Build authentication flow", "# Updated auth flow")
        .replace(
          "**Summary:** Build authentication flow",
          "**Summary:** Updated auth flow",
        );
      throwIfError(await ctx.fs.writeFile(filePath, modified));

      const result = throwIfError(
        await synchronizeModifiedFiles(ctx, filePath),
      );
      expect(result).toMatchObject({
        records: [expect.objectContaining({ title: "Updated auth flow" })],
      });
    });

    it("preserves edit when only one duplicate slot changed", async () => {
      const filePath = join(ctx.config.paths.docs, "summaries/build-auth.md");
      const original = throwIfError(await ctx.fs.readFile(filePath));

      const modified = original.replace(
        "# Build authentication flow",
        "# Different title here",
      );
      throwIfError(await ctx.fs.writeFile(filePath, modified));

      const result = throwIfError(
        await synchronizeModifiedFiles(ctx, filePath),
      );
      expect(result).toMatchObject({
        records: [expect.objectContaining({ title: "Different title here" })],
      });
    });

    it("detects conflict when both duplicate slots changed differently", async () => {
      const filePath = join(ctx.config.paths.docs, "summaries/build-auth.md");
      const original = throwIfError(await ctx.fs.readFile(filePath));

      const modified = original
        .replace("# Build authentication flow", "# Title version A")
        .replace(
          "**Summary:** Build authentication flow",
          "**Summary:** Title version B",
        );
      throwIfError(await ctx.fs.writeFile(filePath, modified));

      const result = await synchronizeModifiedFiles(ctx, filePath);
      expect(result).toBeErrWithKey("field-conflict");
    });
  });

  describe("Case 3: same field across files", () => {
    it("detects conflict when two files change same field differently", async () => {
      const mdPath = join(ctx.config.paths.docs, "tasks/build-auth.md");
      const yamlPath = join(
        ctx.config.paths.docs,
        "tasks-yaml/build-auth.yaml",
      );

      const mdOriginal = throwIfError(await ctx.fs.readFile(mdPath));
      const yamlOriginal = throwIfError(await ctx.fs.readFile(yamlPath));

      const mdModified = mdOriginal.replace(
        "# Build authentication flow",
        "# Auth flow (from markdown)",
      );
      const yamlModified = yamlOriginal.replace(
        "Build authentication flow",
        "Auth flow (from yaml)",
      );

      throwIfError(await ctx.fs.writeFile(mdPath, mdModified));
      throwIfError(await ctx.fs.writeFile(yamlPath, yamlModified));

      const result = await synchronizeModifiedFiles(ctx, ctx.config.paths.docs);
      expect(result).toBeErrWithKey("field-conflict");
    });
  });
});
