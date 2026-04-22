import { dirname, join, relative } from "path";
import { beforeEach, describe, expect, it } from "bun:test";
import { throwIfError } from "@binder/utils";
import "@binder/utils/tests";
import { mockTask1Uid, mockTransactionInitInput } from "@binder/repo/mocks";
import { createMockRuntimeContextWithDb } from "../runtime.mock.ts";
import type { RuntimeContextWithDb } from "../runtime.ts";
import { mockDocumentTransactionInput } from "../document/document.mock.ts";
import { mockNavigationConfigInput } from "../document/navigation.mock.ts";
import { renderDocs } from "../document/repository.ts";
import { docsLintHandler, docsSyncHandler } from "./docs.ts";

describe("docs", () => {
  describe("docsLintHandler", () => {
    let ctx: RuntimeContextWithDb;

    beforeEach(async () => {
      ctx = await createMockRuntimeContextWithDb();
      throwIfError(await ctx.kg.update(mockTransactionInitInput));
      throwIfError(await ctx.kg.update(mockDocumentTransactionInput));
      throwIfError(
        await ctx.kg.update({
          author: "test",
          configs: mockNavigationConfigInput,
        }),
      );
    });

    const createFile = async (relativePath: string, content: string) => {
      const fullPath = join(ctx.config.paths.docs, relativePath);
      throwIfError(await ctx.fs.mkdir(dirname(fullPath), { recursive: true }));
      throwIfError(await ctx.fs.writeFile(fullPath, content));
    };

    it("skips files matching exclude pattern", async () => {
      await createFile("all-tasks.yaml", "items: [unclosed");

      const config = { ...ctx.config, exclude: ["all-tasks.yaml"] };
      const result = await docsLintHandler({ ...ctx, config, args: {} });

      expect(result).toBeOk();
    });

    it("reports errors for files not matching exclude pattern", async () => {
      await createFile("all-tasks.yaml", "items: [unclosed");

      const result = await docsLintHandler({ ...ctx, args: {} });

      expect(result).toBeErr();
    });

    it("only lints files matching include pattern", async () => {
      await createFile("all-tasks.yaml", "items: [unclosed");

      const config = { ...ctx.config, include: ["other/**"] };
      const result = await docsLintHandler({ ...ctx, config, args: {} });

      expect(result).toBeOk();
    });
  });

  describe("docsSyncHandler", () => {
    let ctx: RuntimeContextWithDb;

    beforeEach(async () => {
      ctx = await createMockRuntimeContextWithDb();
      throwIfError(await ctx.kg.update(mockTransactionInitInput));
      throwIfError(
        await ctx.kg.update({
          author: "test",
          configs: mockNavigationConfigInput,
        }),
      );
      throwIfError(await renderDocs(ctx));
    });

    const modifyRenderedFile = async () => {
      const absolutePath = join(ctx.config.paths.docs, "all-tasks.yaml");
      const content = throwIfError(await ctx.fs.readFile(absolutePath));
      const modified = content.replace(
        "Implement user authentication",
        "Updated task title",
      );
      throwIfError(await ctx.fs.writeFile(absolutePath, modified));
    };

    const expectTaskTitleChanged = async () => {
      const entity = throwIfError(
        await ctx.kg.fetchEntity(mockTask1Uid, undefined, "record"),
      );
      expect(entity.title).toBe("Updated task title");
    };

    it("detects changes when path is absolute", async () => {
      await modifyRenderedFile();

      const result = await docsSyncHandler({
        ...ctx,
        args: { path: join(ctx.config.paths.docs, "all-tasks.yaml") },
      });

      expect(result).toBeOk();
      await expectTaskTitleChanged();
    });

    it("detects changes when path is root-relative", async () => {
      await modifyRenderedFile();
      const docsDir = relative(ctx.config.paths.root, ctx.config.paths.docs);

      const result = await docsSyncHandler({
        ...ctx,
        args: { path: `${docsDir}/all-tasks.yaml` },
      });

      expect(result).toBeOk();
      await expectTaskTitleChanged();
    });

    it("detects changes when path is docs-relative", async () => {
      await modifyRenderedFile();

      const result = await docsSyncHandler({
        ...ctx,
        args: { path: "all-tasks.yaml" },
      });

      expect(result).toBeOk();
      await expectTaskTitleChanged();
    });
  });
});
