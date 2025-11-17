import { describe, expect, it } from "bun:test";
import { throwIfError } from "@binder/utils";
import type { FieldsetNested } from "@binder/db";
import { diffNodeLists, diffNodeTrees } from "./node-diff.ts";

describe("diffNodeTrees", () => {
  const check = (
    newNode: FieldsetNested,
    oldNode: FieldsetNested,
    expected: object[],
  ) => {
    const result = throwIfError(diffNodeTrees(newNode, oldNode));
    expect(result).toEqual(expected.map((e) => expect.objectContaining(e)));
  };

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

    check(doc, doc, []);
  });

  it("detects field updates in document root", () => {
    check(
      {
        type: "Document",
        title: "Updated Title",
        blockContent: [],
      },
      {
        type: "Document",
        uid: "doc-1",
        title: "Original Title",
        blockContent: [],
      },
      [{ $ref: "doc-1", title: "Updated Title" }],
    );
  });

  it("detects field updates in nested nodes", () => {
    check(
      {
        type: "Document",
        blockContent: [
          {
            type: "Section",
            title: "Updated Section Title",
            blockContent: [],
          },
        ],
      },
      {
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
      },
      [{ $ref: "section-1", title: "Updated Section Title" }],
    );
  });

  it("creates changeset for new nodes", () => {
    check(
      {
        type: "Document",
        blockContent: [
          {
            type: "Section",
            title: "New Section",
            blockContent: [],
          },
        ],
      },
      {
        type: "Document",
        uid: "doc-1",
        blockContent: [],
      },
      [{ type: "Section", title: "New Section" }],
    );
  });

  it("creates changesets for multiple new nodes", () => {
    check(
      {
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
      },
      {
        type: "Document",
        uid: "doc-1",
        blockContent: [],
      },
      [
        { type: "Section", title: "Section 1" },
        { type: "Section", title: "Section 2" },
        { type: "Paragraph", textContent: "First paragraph" },
      ],
    );
  });

  it("matches nodes by position when types match", () => {
    check(
      {
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
      },
      {
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
      },
      [{ $ref: "para-1", textContent: "Updated first paragraph" }],
    );
  });

  it("matches nodes by content when position differs", () => {
    check(
      {
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
      },
      {
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
      },
      [
        { $ref: "section-2", title: "Introduction" },
        { $ref: "section-1", title: "Conclusion" },
      ],
    );
  });

  it("handles mixed updates and new nodes", () => {
    check(
      {
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
      },
      {
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
      },
      [
        { $ref: "section-1", title: "Updated Section" },
        { type: "Paragraph", textContent: "New paragraph" },
      ],
    );
  });

  it("handles deeply nested structures", () => {
    check(
      {
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
      },
      {
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
      },
      [{ $ref: "item-1", textContent: "Updated item" }],
    );
  });

  it("handles dataview nodes with query field", () => {
    check(
      {
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
      },
      {
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
      },
      [
        {
          $ref: "dataview-1",
          query: { filters: { type: "Task", status: "active" } },
        },
      ],
    );
  });

  it("creates new nodes when type differs at same position", () => {
    check(
      {
        type: "Document",
        blockContent: [
          {
            type: "Section",
            title: "New Section",
            blockContent: [],
          },
        ],
      },
      {
        type: "Document",
        uid: "doc-1",
        blockContent: [
          {
            type: "Paragraph",
            uid: "para-1",
            textContent: "Old paragraph",
          },
        ],
      },
      [{ type: "Section", title: "New Section" }],
    );
  });

  it("ignores system fields in changesets", () => {
    check(
      {
        type: "Document",
        title: "My Document",
        blockContent: [],
      },
      {
        type: "Document",
        uid: "doc-1",
        id: 123,
        version: 5,
        title: "My Document",
        blockContent: [],
      },
      [],
    );
  });

  it("ignores null values when previous value was null or undefined", () => {
    check(
      {
        type: "Document",
        title: "My Document",
        status: null,
        blockContent: [],
      },
      {
        type: "Document",
        uid: "doc-1",
        title: "My Document",
        blockContent: [],
      },
      [],
    );
  });

  it("detects when null value replaces non-null value", () => {
    check(
      {
        type: "Document",
        title: "My Document",
        status: null,
        blockContent: [],
      },
      {
        type: "Document",
        uid: "doc-1",
        title: "My Document",
        status: "active",
        blockContent: [],
      },
      [{ $ref: "doc-1", status: null }],
    );
  });

  it("detects changes in dataview data items", () => {
    check(
      {
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
      },
      {
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
      },
      [
        {
          $ref: "task-1",
          title: "Updated Task",
          description: "New description",
        },
        { type: "Task", title: "New Task", description: "Added task" },
      ],
    );
  });

  it("applies all query fields to new dataview items", () => {
    check(
      {
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
      },
      {
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
      },
      [
        {
          type: "Idea",
          ideaStatus: "exploring",
          title: "Implement real-time collaboration",
        },
        { type: "Idea", ideaStatus: "exploring", title: "Add something extra" },
      ],
    );
  });
});

describe("diffNodeLists", () => {
  const check = (
    newNodes: FieldsetNested[],
    oldNodes: FieldsetNested[],
    expected: object[],
  ) => {
    const result = throwIfError(diffNodeLists(newNodes, oldNodes));
    expect(result).toEqual(expected.map((e) => expect.objectContaining(e)));
  };

  it("returns empty changesets when lists are identical", () => {
    const items: FieldsetNested[] = [
      { type: "Task", uid: "task-1", title: "Task 1", status: "pending" },
      { type: "Task", uid: "task-2", title: "Task 2", status: "done" },
    ];

    check(items, items, []);
  });

  it("detects field updates in list items", () => {
    check(
      [{ type: "Task", title: "Updated Task", status: "done" }],
      [
        {
          type: "Task",
          uid: "task-1",
          title: "Original Task",
          status: "pending",
        },
      ],
      [{ $ref: "task-1", title: "Updated Task", status: "done" }],
    );
  });

  it("creates new items when file has more items", () => {
    check(
      [
        { type: "Task", title: "Task 1", status: "pending" },
        { type: "Task", title: "New Task", status: "active" },
      ],
      [{ type: "Task", uid: "task-1", title: "Task 1", status: "pending" }],
      [{ type: "Task", title: "New Task", status: "active" }],
    );
  });

  it("matches items by position first when types match", () => {
    check(
      [
        { type: "Task", title: "Task B", status: "done" },
        { type: "Task", title: "Task A", status: "active" },
      ],
      [
        { type: "Task", uid: "task-a", title: "Task A", status: "pending" },
        { type: "Task", uid: "task-b", title: "Task B", status: "done" },
      ],
      [
        { $ref: "task-a", title: "Task B", status: "done" },
        { $ref: "task-b", title: "Task A", status: "active" },
      ],
    );
  });

  it("handles mixed updates and creates", () => {
    check(
      [
        { type: "Task", title: "Updated Task", status: "done" },
        { type: "Task", title: "Brand New Task", status: "active" },
      ],
      [
        {
          type: "Task",
          uid: "task-1",
          title: "Original Task",
          status: "pending",
        },
      ],
      [
        { $ref: "task-1", title: "Updated Task", status: "done" },
        { type: "Task", title: "Brand New Task", status: "active" },
      ],
    );
  });
});
