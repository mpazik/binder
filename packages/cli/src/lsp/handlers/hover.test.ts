import { describe, expect, it } from "bun:test";
import type { FieldAttrDef, FieldDef } from "@binder/repo";
import {
  mockAssignedToField,
  mockCompletedAtField,
  mockEmailField,
  mockFavoriteField,
  mockOwnersField,
  mockProjectField,
  mockStatusField,
} from "@binder/repo/mocks";
import {
  type EntityHoverInput,
  type FieldHoverInput,
  renderHoverContent,
  type ViewHoverInput,
} from "./hover.ts";

describe("renderHoverContent", () => {
  describe("field-key hover", () => {
    const check = (
      fieldDef: FieldDef,
      expected: string,
      fieldAttrs?: FieldAttrDef,
    ) => {
      const input: FieldHoverInput = { kind: "field", fieldDef, fieldAttrs };
      expect(renderHoverContent(input)).toBe(expected);
    };

    it("renders field with name and dataType", () => {
      check(mockFavoriteField, "**Favorite** (boolean)\n\nFavorite item");
    });

    it("renders field without description", () => {
      check(
        { ...mockFavoriteField, description: undefined },
        "**Favorite** (boolean)",
      );
    });

    it("renders field with required constraint from attrs", () => {
      check(
        { ...mockFavoriteField, description: undefined },
        "**Favorite** (boolean)\n\n---\n\n**Constraints:**\n- Required: yes",
        { required: true },
      );
    });

    it("renders field with unique constraint", () => {
      check(
        mockEmailField,
        "**Email** (plaintext)\n\nEmail address\n\n---\n\n**Constraints:**\n- Unique: yes",
      );
    });

    it("renders field with allowMultiple constraint", () => {
      check(
        mockOwnersField,
        "**Owners** (relation)\n\nMultiple responsible parties\n\n---\n\n**Constraints:**\n- Allow Multiple: yes\n\n**Range:** User, Team",
      );
    });

    it("renders field with default value from attrs", () => {
      check(
        { ...mockFavoriteField, description: undefined },
        "**Favorite** (boolean)\n\n---\n\n**Constraints:**\n- Default: true",
        { default: true },
      );
    });

    it("renders field with when condition", () => {
      check(
        mockCompletedAtField,
        "**Completed At** (datetime)\n\nWhen task was completed\n\n---\n\n**Constraints:**\n- When: status=complete",
      );
    });

    it("renders relation field with range", () => {
      check(
        mockAssignedToField,
        "**Assigned To** (relation)\n\nResponsible party\n\n**Range:** User, Team",
      );
    });

    it("renders option field with options list", () => {
      check(
        { ...mockStatusField, description: undefined },
        "**Status** (option)\n\n**Options:**\n- **pending**: Pending\n- **active**: Active\n- **complete**: Complete\n- **cancelled**: Cancelled\n- **archived**: Archived",
      );
    });

    it("renders option field with key only when name is absent", () => {
      const field: FieldDef = {
        ...mockStatusField,
        description: undefined,
        options: [{ key: "alpha" }, { key: "beta" }, { key: "gamma" }],
      };
      check(
        field,
        "**Status** (option)\n\n**Options:**\n- **alpha**\n- **beta**\n- **gamma**",
      );
    });

    it("renders option field with mixed named and unnamed options", () => {
      const field: FieldDef = {
        ...mockStatusField,
        description: undefined,
        options: [
          { key: "pending", name: "Pending" },
          { key: "custom" },
          { key: "archived", name: "Archived" },
        ],
      };
      check(
        field,
        "**Status** (option)\n\n**Options:**\n- **pending**: Pending\n- **custom**\n- **archived**: Archived",
      );
    });

    it("combines multiple constraints", () => {
      check(
        { ...mockEmailField, allowMultiple: true, when: { status: "active" } },
        "**Email** (plaintext)\n\nEmail address\n\n---\n\n**Constraints:**\n- When: status=active\n- Unique: yes\n- Allow Multiple: yes",
      );
    });
  });

  describe("field-value hover", () => {
    const check = (
      fieldDef: FieldDef,
      expected: string,
      fieldAttrs?: FieldAttrDef,
      relationFieldDef?: FieldDef,
    ) => {
      const input: FieldHoverInput = {
        kind: "field",
        fieldDef,
        fieldAttrs,
        relationFieldDef,
      };
      expect(renderHoverContent(input)).toBe(expected);
    };

    const titleFieldDef: FieldDef = {
      id: 1 as FieldDef["id"],
      key: "title" as FieldDef["key"],
      name: "Title",
      description: "Entity title",
      dataType: "plaintext",
    };

    it("renders same content as field-key hover", () => {
      check(
        mockProjectField,
        "**Project** (relation)\n\nPart of project\n\n**Range:** Project",
      );
    });

    it("renders nested field (e.g., project.title resolved to title field)", () => {
      check(titleFieldDef, "**Title** (plaintext)\n\nEntity title");
    });

    it("renders nested field with attrs from parent type", () => {
      check(
        { ...titleFieldDef, description: undefined },
        "**Title** (plaintext)\n\n---\n\n**Constraints:**\n- Required: yes",
        { required: true },
      );
    });

    it("renders field from relation with source info", () => {
      check(
        titleFieldDef,
        "**Title** (plaintext)\n\nEntity title\n\n**From:** Project (relation)",
        undefined,
        mockProjectField,
      );
    });
  });

  describe("entity hover", () => {
    const check = (input: EntityHoverInput, expected: string) => {
      expect(renderHoverContent(input)).toBe(expected);
    };

    it("renders entity with key, type, title, and description", () => {
      check(
        {
          kind: "entity",
          key: "mvp-release",
          name: "MVP Release",
          title: "MVP Release Milestone",
          description: "First public release",
          typeName: "Milestone",
        },
        "`mvp-release`: *Milestone*\n\n**MVP Release Milestone**\n\nFirst public release",
      );
    });

    it("renders entity with title only", () => {
      check({ kind: "entity", title: "Some Record" }, "**Some Record**");
    });

    it("renders entity with key only", () => {
      check({ kind: "entity", key: "my-key" }, "`my-key`");
    });

    it("renders entity with name only", () => {
      check({ kind: "entity", name: "My Name" }, "**My Name**");
    });

    it("renders entity with no identifiers", () => {
      check({ kind: "entity" }, "");
    });

    it("renders entity with key and type only", () => {
      check(
        { kind: "entity", key: "feat-x", typeName: "Task" },
        "`feat-x`: *Task*",
      );
    });

    it("renders entity with type and title only", () => {
      check(
        { kind: "entity", typeName: "Task", title: "Fix the bug" },
        "*Task*\n\n**Fix the bug**",
      );
    });

    it("renders entity with type and description but no title", () => {
      check(
        {
          kind: "entity",
          key: "feat-x",
          description: "A feature",
          typeName: "Task",
        },
        "`feat-x`: *Task*\n\nA feature",
      );
    });

    it("uses title over name for display name", () => {
      check(
        { kind: "entity", title: "The Title", name: "The Name" },
        "**The Title**",
      );
    });

    it("uses name when title is absent", () => {
      check(
        { kind: "entity", name: "The Name", typeName: "Concept" },
        "*Concept*\n\n**The Name**",
      );
    });
  });

  describe("view hover", () => {
    const check = (input: ViewHoverInput, expected: string) => {
      expect(renderHoverContent(input)).toBe(expected);
    };

    it("renders view with name", () => {
      check(
        {
          kind: "view",
          viewKey: "my-view",
          viewName: "My View",
        },
        "**My View** (view)",
      );
    });

    it("renders view with key only when no name", () => {
      check(
        { kind: "view", viewKey: "__document__" },
        "**__document__** (view)",
      );
    });

    it("renders view with description", () => {
      check(
        {
          kind: "view",
          viewKey: "task-detail",
          viewName: "Task Detail",
          viewDescription: "Displays task information in detail view",
        },
        "**Task Detail** (view)\n\nDisplays task information in detail view",
      );
    });

    it("renders view with name and description", () => {
      check(
        {
          kind: "view",
          viewKey: "project-summary",
          viewName: "Project Summary",
          viewDescription: "Overview of project status",
          viewFormat: "section",
        },
        "**Project Summary** (view)\n\nOverview of project status",
      );
    });
  });
});
