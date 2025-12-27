import { describe, it, expect } from "bun:test";
import { createPathMatcher } from "./file.ts";

describe("createPathMatcher", () => {
  it("returns true for all paths when no options provided", () => {
    const matcher = createPathMatcher({});
    expect(matcher("anything.md")).toBe(true);
    expect(matcher("dir/file.yaml")).toBe(true);
  });

  it("matches only paths matching includePatterns", () => {
    const matcher = createPathMatcher({
      include: [".binder/*.yaml"],
    });
    expect(matcher(".binder/fields.yaml")).toBe(true);
    expect(matcher(".binder/types.yaml")).toBe(true);
    expect(matcher(".types.yaml")).toBe(false);
    expect(matcher(".binder/logs/app.log")).toBe(false);
    expect(matcher(".binder/backup.bac")).toBe(false);
  });

  it("excludes paths matching ignore patterns", () => {
    const matcher = createPathMatcher({
      exclude: ["*.bac", "logs/**"],
    });
    expect(matcher("file.md")).toBe(true);
    expect(matcher("backup.bac")).toBe(false);
    expect(matcher("logs/app.log")).toBe(false);
    expect(matcher("logs/nested/debug.log")).toBe(false);
  });

  it("handles multiple ignore patterns", () => {
    const matcher = createPathMatcher({
      exclude: ["*.bac", "*.log", "node_modules/**"],
    });
    expect(matcher("file.md")).toBe(true);
    expect(matcher("backup.bac")).toBe(false);
    expect(matcher("app.log")).toBe(false);
    expect(matcher("node_modules/pkg/index.js")).toBe(false);
  });

  it("ignores dotfiles when dot option is enabled", () => {
    const matcher = createPathMatcher({
      exclude: [".*"],
    });
    expect(matcher(".gitignore")).toBe(false);
    expect(matcher(".env")).toBe(false);
    expect(matcher("file.md")).toBe(true);
  });

  it("applies both include and exclude patterns", () => {
    const matcher = createPathMatcher({
      include: ["**/*.md"],
      exclude: ["**/draft*"],
    });
    expect(matcher("task.md")).toBe(true);
    expect(matcher("docs/note.md")).toBe(true);
    expect(matcher("draft.md")).toBe(false);
    expect(matcher("docs/draft-ideas.md")).toBe(false);
    expect(matcher("task.yaml")).toBe(false);
  });
});
