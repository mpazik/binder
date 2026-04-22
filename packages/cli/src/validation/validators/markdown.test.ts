import { describe, expect, it } from "bun:test";
import type { KnowledgeGraph } from "@binder/repo";
import { mockRecordSchema } from "@binder/repo/mocks";
import { parseMarkdownDocument } from "../../document/markdown.ts";
import { createMarkdownValidator } from "./markdown.ts";

describe("createMarkdownValidator", () => {
  const validator = createMarkdownValidator();

  const mockKg = {} as KnowledgeGraph;

  const mockNavigationItem = {
    path: "test",
    where: { type: "Task" },
    includes: { id: true, title: true, status: true },
  };

  const check = async (
    text: string,
    expectedErrors: Array<{ code: string; severity: string }>,
  ) => {
    const content = parseMarkdownDocument(text);
    const errors = await validator.validate(content, {
      filePath: "test.md",
      navigationItem: mockNavigationItem,
      namespace: "record",
      schema: mockRecordSchema,
      ruleConfig: {},
      kg: mockKg,
    });

    expect(errors).toEqual(
      expectedErrors.map((err) => expect.objectContaining(err)),
    );
  };

  it("detects malformed YAML frontmatter", async () => {
    await check(`---\nstatus: [[[broken\n---\n\nSome content`, [
      { code: "yaml-syntax-error", severity: "error" },
    ]);
  });

  it("returns no errors for valid YAML frontmatter", async () => {
    await check(`---\ntitle: Hello\nstatus: active\n---\n\nSome content`, []);
  });

  it("returns no errors for markdown without frontmatter", async () => {
    await check(`# Hello\n\nSome content`, []);
  });

  it("reports error with correct line position", async () => {
    const content = parseMarkdownDocument(
      `---\ntitle: Hello\nstatus: [[[broken\n---\n\nBody`,
    );
    const errors = await validator.validate(content, {
      filePath: "test.md",
      navigationItem: mockNavigationItem,
      namespace: "record",
      schema: mockRecordSchema,
      ruleConfig: {},
      kg: mockKg,
    });

    expect(errors[0]).toMatchObject({
      code: "yaml-syntax-error",
      range: { start: { line: 2 } },
    });
  });
});
