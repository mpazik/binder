import { describe, expect, it } from "bun:test";
import { throwIfError } from "@binder/utils";
import type { FieldsetNested } from "@binder/db";
import { diffNodeTrees } from "./tree-diff.ts";

describe("diffNodeTrees", () => {
  it("returns empty changesets when file and kg are identical", () => {
    const doc: FieldsetNested = {
      type: "Document",
      uid: "doc-1",
      blockContent: [
        {
          type: "Section",
          uid: "section-1",
          title: "Introduction",
          blockContent: [
            {
              type: "Paragraph",
              uid: "para-1",
              textContent: "Hello world",
            },
          ],
        },
      ],
    };

    const result = throwIfError(diffNodeTrees(doc, doc));
    expect(result).toEqual([]);
  });

  it("detects field updates in document root", () => {
    const file: FieldsetNested = {
      type: "Document",
      title: "Updated Title",
      blockContent: [],
    };

    const kg: FieldsetNested = {
      type: "Document",
      uid: "doc-1",
      title: "Original Title",
      blockContent: [],
    };

    const result = throwIfError(diffNodeTrees(file, kg));
    expect(result).toEqual([
      expect.objectContaining({
        $ref: "doc-1",
        title: "Updated Title",
      }),
    ]);
  });

  it("detects field updates in nested nodes", () => {
    const file: FieldsetNested = {
      type: "Document",
      blockContent: [
        {
          type: "Section",
          title: "Updated Section Title",
          blockContent: [],
        },
      ],
    };

    const kg: FieldsetNested = {
      type: "Document",
      uid: "doc-1",
      blockContent: [
        {
          type: "Section",
          uid: "section-1",
          title: "Original Section Title",
          blockContent: [],
        },
      ],
    };

    const result = throwIfError(diffNodeTrees(file, kg));
    expect(result).toEqual([
      expect.objectContaining({
        $ref: "section-1",
        title: "Updated Section Title",
      }),
    ]);
  });

  it("creates changeset for new nodes", () => {
    const file: FieldsetNested = {
      type: "Document",
      blockContent: [
        {
          type: "Section",
          title: "New Section",
          blockContent: [],
        },
      ],
    };

    const kg: FieldsetNested = {
      type: "Document",
      uid: "doc-1",
      blockContent: [],
    };

    const result = throwIfError(diffNodeTrees(file, kg));
    expect(result).toEqual([
      expect.objectContaining({
        type: "Section",
        title: "New Section",
      }),
    ]);
  });

  it("creates changesets for multiple new nodes", () => {
    const file: FieldsetNested = {
      type: "Document",
      blockContent: [
        {
          type: "Section",
          title: "Section 1",
          blockContent: [
            {
              type: "Paragraph",
              textContent: "First paragraph",
            },
          ],
        },
        {
          type: "Section",
          title: "Section 2",
          blockContent: [],
        },
      ],
    };

    const kg: FieldsetNested = {
      type: "Document",
      uid: "doc-1",
      blockContent: [],
    };

    const result = throwIfError(diffNodeTrees(file, kg));
    expect(result).toEqual([
      expect.objectContaining({
        type: "Section",
        title: "Section 1",
      }),
      expect.objectContaining({
        type: "Section",
        title: "Section 2",
      }),
      expect.objectContaining({
        type: "Paragraph",
        textContent: "First paragraph",
      }),
    ]);
  });

  it("matches nodes by position when types match", () => {
    const file: FieldsetNested = {
      type: "Document",
      blockContent: [
        {
          type: "Paragraph",
          textContent: "Updated first paragraph",
        },
        {
          type: "Paragraph",
          textContent: "Second paragraph unchanged",
        },
      ],
    };

    const kg: FieldsetNested = {
      type: "Document",
      uid: "doc-1",
      blockContent: [
        {
          type: "Paragraph",
          uid: "para-1",
          textContent: "Original first paragraph",
        },
        {
          type: "Paragraph",
          uid: "para-2",
          textContent: "Second paragraph unchanged",
        },
      ],
    };

    const result = throwIfError(diffNodeTrees(file, kg));
    expect(result).toEqual([
      expect.objectContaining({
        $ref: "para-1",
        textContent: "Updated first paragraph",
      }),
    ]);
  });

  it("matches nodes by content when position differs", () => {
    const file: FieldsetNested = {
      type: "Document",
      blockContent: [
        {
          type: "Section",
          title: "Introduction",
          blockContent: [],
        },
        {
          type: "Section",
          title: "Conclusion",
          blockContent: [],
        },
      ],
    };

    const kg: FieldsetNested = {
      type: "Document",
      uid: "doc-1",
      blockContent: [
        {
          type: "Section",
          uid: "section-2",
          title: "Conclusion",
          blockContent: [],
        },
        {
          type: "Section",
          uid: "section-1",
          title: "Introduction",
          blockContent: [],
        },
      ],
    };

    const result = throwIfError(diffNodeTrees(file, kg));
    expect(result).toEqual([
      expect.objectContaining({
        $ref: "section-2",
        title: "Introduction",
      }),
      expect.objectContaining({
        $ref: "section-1",
        title: "Conclusion",
      }),
    ]);
  });

  it("handles mixed updates and new nodes", () => {
    const file: FieldsetNested = {
      type: "Document",
      blockContent: [
        {
          type: "Section",
          title: "Updated Section",
          blockContent: [
            {
              type: "Paragraph",
              textContent: "Existing paragraph",
            },
            {
              type: "Paragraph",
              textContent: "New paragraph",
            },
          ],
        },
      ],
    };

    const kg: FieldsetNested = {
      type: "Document",
      uid: "doc-1",
      blockContent: [
        {
          type: "Section",
          uid: "section-1",
          title: "Original Section",
          blockContent: [
            {
              type: "Paragraph",
              uid: "para-1",
              textContent: "Existing paragraph",
            },
          ],
        },
      ],
    };

    const result = throwIfError(diffNodeTrees(file, kg));
    expect(result).toEqual([
      expect.objectContaining({
        $ref: "section-1",
        title: "Updated Section",
      }),
      expect.objectContaining({
        type: "Paragraph",
        textContent: "New paragraph",
      }),
    ]);
  });

  it("handles deeply nested structures", () => {
    const file: FieldsetNested = {
      type: "Document",
      blockContent: [
        {
          type: "Section",
          title: "Section",
          blockContent: [
            {
              type: "List",
              blockContent: [
                {
                  type: "ListItem",
                  textContent: "Updated item",
                },
              ],
            },
          ],
        },
      ],
    };

    const kg: FieldsetNested = {
      type: "Document",
      uid: "doc-1",
      blockContent: [
        {
          type: "Section",
          uid: "section-1",
          title: "Section",
          blockContent: [
            {
              type: "List",
              uid: "list-1",
              blockContent: [
                {
                  type: "ListItem",
                  uid: "item-1",
                  textContent: "Original item",
                },
              ],
            },
          ],
        },
      ],
    };

    const result = throwIfError(diffNodeTrees(file, kg));
    expect(result).toEqual([
      expect.objectContaining({
        $ref: "item-1",
        textContent: "Updated item",
      }),
    ]);
  });

  it("handles dataview nodes with query field", () => {
    const file: FieldsetNested = {
      type: "Document",
      blockContent: [
        {
          type: "Section",
          title: "Tasks",
          blockContent: [
            {
              type: "Dataview",
              query: { filters: { type: "Task", status: "active" } },
            },
          ],
        },
      ],
    };

    const kg: FieldsetNested = {
      type: "Document",
      uid: "doc-1",
      blockContent: [
        {
          type: "Section",
          uid: "section-1",
          title: "Tasks",
          blockContent: [
            {
              type: "Dataview",
              uid: "dataview-1",
              query: { filters: { type: "Task" } },
            },
          ],
        },
      ],
    };

    const result = throwIfError(diffNodeTrees(file, kg));
    expect(result).toEqual([
      expect.objectContaining({
        $ref: "dataview-1",
        query: { filters: { type: "Task", status: "active" } },
      }),
    ]);
  });

  it("creates new nodes when type differs at same position", () => {
    const file: FieldsetNested = {
      type: "Document",
      blockContent: [
        {
          type: "Section",
          title: "New Section",
          blockContent: [],
        },
      ],
    };

    const kg: FieldsetNested = {
      type: "Document",
      uid: "doc-1",
      blockContent: [
        {
          type: "Paragraph",
          uid: "para-1",
          textContent: "Old paragraph",
        },
      ],
    };

    const result = throwIfError(diffNodeTrees(file, kg));
    expect(result).toEqual([
      expect.objectContaining({
        type: "Section",
        title: "New Section",
      }),
    ]);
  });

  it("ignores system fields in changesets", () => {
    const file: FieldsetNested = {
      type: "Document",
      title: "My Document",
      blockContent: [],
    };

    const kg: FieldsetNested = {
      type: "Document",
      uid: "doc-1",
      id: 123,
      version: 5,
      title: "My Document",
      blockContent: [],
    };

    const result = throwIfError(diffNodeTrees(file, kg));
    expect(result).toEqual([]);
  });

  it("ignores null values when previous value was null or undefined", () => {
    const file: FieldsetNested = {
      type: "Document",
      title: "My Document",
      status: null,
      blockContent: [],
    };

    const kg: FieldsetNested = {
      type: "Document",
      uid: "doc-1",
      title: "My Document",
      blockContent: [],
    };

    const result = throwIfError(diffNodeTrees(file, kg));
    expect(result).toEqual([]);
  });

  it("detects when null value replaces non-null value", () => {
    const file: FieldsetNested = {
      type: "Document",
      title: "My Document",
      status: null,
      blockContent: [],
    };

    const kg: FieldsetNested = {
      type: "Document",
      uid: "doc-1",
      title: "My Document",
      status: "active",
      blockContent: [],
    };

    const result = throwIfError(diffNodeTrees(file, kg));
    expect(result).toEqual([
      expect.objectContaining({
        $ref: "doc-1",
        status: null,
      }),
    ]);
  });

  it("detects changes in dataview data items", () => {
    const file: FieldsetNested = {
      type: "Document",
      blockContent: [
        {
          type: "Dataview",
          query: { filters: { type: "Task" } },
          data: [
            {
              title: "Updated Task",
              description: "New description",
            },
            {
              title: "New Task",
              description: "Added task",
            },
          ],
        },
      ],
    };

    const kg: FieldsetNested = {
      type: "Document",
      uid: "doc-1",
      blockContent: [
        {
          type: "Dataview",
          uid: "dataview-1",
          query: { filters: { type: "Task" } },
          data: [
            {
              type: "Task",
              uid: "task-1",
              title: "Old Task",
              description: "Old description",
            },
          ],
        },
      ],
    };

    const result = throwIfError(diffNodeTrees(file, kg));
    expect(result).toEqual([
      expect.objectContaining({
        $ref: "task-1",
        title: "Updated Task",
        description: "New description",
      }),
      expect.objectContaining({
        type: "Task",
        title: "New Task",
        description: "Added task",
      }),
    ]);
  });

  it("applies all query fields to new dataview items", () => {
    const file: FieldsetNested = {
      type: "Document",
      blockContent: [
        {
          type: "Dataview",
          query: { filters: { type: "Idea", ideaStatus: "exploring" } },
          data: [
            {
              title: "Implement real-time collaboration",
            },
            {
              title: "Add something extra",
            },
          ],
        },
      ],
    };

    const kg: FieldsetNested = {
      type: "Document",
      uid: "doc-1",
      blockContent: [
        {
          type: "Dataview",
          uid: "dataview-1",
          query: { filters: { type: "Idea", ideaStatus: "exploring" } },
          data: [],
        },
      ],
    };

    const result = throwIfError(diffNodeTrees(file, kg));
    expect(result).toEqual([
      expect.objectContaining({
        type: "Idea",
        ideaStatus: "exploring",
        title: "Implement real-time collaboration",
      }),
      expect.objectContaining({
        type: "Idea",
        ideaStatus: "exploring",
        title: "Add something extra",
      }),
    ]);
  });
});
