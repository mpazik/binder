import { dirname, join, relative } from "path";
import { beforeEach, describe, expect, it } from "bun:test";
import { throwIfError } from "@binder/utils";
import "@binder/utils/tests";
import { mockTask1Uid, mockTransactionInitInput } from "@binder/repo/mocks";
import { createMockRuntimeContextWithDb } from "../../runtime.mock";
import type { RuntimeContextWithDb } from "../../runtime";
import { mockDocumentTransactionInput } from "../../document/document.mock";
import { mockNavigationConfigInput } from "../../document/navigation.mock";
import { renderDocs } from "../../document/repository";
import { docsLintHandler, docsSyncHandler } from "./commands";

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

    const check = async (
      configOverrides: Partial<RuntimeContextWithDb["config"]>,
      expected: "ok" | "err",
    ) => {
      const filePath = join(ctx.config.paths.docs, "all-tasks.yaml");
      throwIfError(await ctx.fs.mkdir(dirname(filePath), { recursive: true }));
      throwIfError(await ctx.fs.writeFile(filePath, "items: [unclosed"));

      const config = { ...ctx.config, ...configOverrides };
      const result = await docsLintHandler({ ...ctx, config, args: {} });

      if (expected === "ok") expect(result).toBeOk();
      else expect(result).toBeErr();
    };

    it("skips files matching exclude pattern", async () => {
      await check({ exclude: ["all-tasks.yaml"] }, "ok");
    });

    it("reports errors for files not matching exclude pattern", async () => {
      await check({}, "err");
    });

    it("only lints files matching include pattern", async () => {
      await check({ include: ["other/**"] }, "ok");
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

    const check = async (path: string) => {
      const absolutePath = join(ctx.config.paths.docs, "all-tasks.yaml");
      const content = throwIfError(await ctx.fs.readFile(absolutePath));
      throwIfError(
        await ctx.fs.writeFile(
          absolutePath,
          content.replace(
            "Implement user authentication",
            "Updated task title",
          ),
        ),
      );

      const result = await docsSyncHandler({ ...ctx, args: { path } });
      expect(result).toBeOk();

      const entity = throwIfError(
        await ctx.kg.fetchEntity(mockTask1Uid, undefined, "record"),
      );
      expect(entity.title).toBe("Updated task title");
    };

    it("detects changes when path is absolute", async () => {
      await check(join(ctx.config.paths.docs, "all-tasks.yaml"));
    });

    it("detects changes when path is root-relative", async () => {
      const docsDir = relative(ctx.config.paths.root, ctx.config.paths.docs);
      await check(`${docsDir}/all-tasks.yaml`);
    });

    it("detects changes when path is docs-relative", async () => {
      await check("all-tasks.yaml");
    });
  });
});
