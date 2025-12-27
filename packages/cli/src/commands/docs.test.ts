import { dirname, join } from "path";
import { beforeEach, describe, expect, it } from "bun:test";
import { throwIfError } from "@binder/utils";
import "@binder/utils/tests";
import { mockTransactionInitInput } from "@binder/db/mocks";
import { createMockRuntimeContextWithDb } from "../runtime.mock.ts";
import type { RuntimeContextWithDb } from "../runtime.ts";
import { mockDocumentTransactionInput } from "../document/document.mock.ts";
import { mockNavigationConfigInput } from "../document/navigation.mock.ts";
import { docsLintHandler } from "./docs.ts";

describe("docsLintHandler", () => {
  let ctx: RuntimeContextWithDb;

  beforeEach(async () => {
    ctx = await createMockRuntimeContextWithDb();
    throwIfError(await ctx.kg.update(mockTransactionInitInput));
    throwIfError(await ctx.kg.update(mockDocumentTransactionInput));
    throwIfError(
      await ctx.kg.update({
        author: "test",
        configurations: mockNavigationConfigInput,
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
