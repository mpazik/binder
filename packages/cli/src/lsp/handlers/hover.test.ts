import { describe, expect, it } from "bun:test";
import type { FieldAttrDef, FieldDef } from "@binder/db";
import {
  mockAssignedToField,
  mockCompletedAtField,
  mockEmailField,
  mockFavoriteField,
  mockOwnersField,
  mockProjectField,
  mockStatusField,
} from "@binder/db/mocks";
import {
  type FieldHoverInput,
  renderHoverContent,
  type TemplateHoverInput,
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

    it("renders same content as field-key hover", () => {
      check(
        mockProjectField,
        "**Project** (relation)\n\nPart of project\n\n**Range:** Project",
      );
    });

    it("renders nested field (e.g., project.title resolved to title field)", () => {
      const titleFieldDef: FieldDef = {
        id: 1 as FieldDef["id"],
        key: "title" as FieldDef["key"],
        name: "Title",
        description: "Entity title",
        dataType: "plaintext",
      };
      check(titleFieldDef, "**Title** (plaintext)\n\nEntity title");
    });

    it("renders nested field with attrs from parent type", () => {
      const titleFieldDef: FieldDef = {
        id: 1 as FieldDef["id"],
        key: "title" as FieldDef["key"],
        name: "Title",
        dataType: "plaintext",
      };
      check(
        titleFieldDef,
        "**Title** (plaintext)\n\n---\n\n**Constraints:**\n- Required: yes",
        { required: true },
      );
    });

    it("renders field from relation with source info", () => {
      const titleFieldDef: FieldDef = {
        id: 1 as FieldDef["id"],
        key: "title" as FieldDef["key"],
        name: "Title",
        description: "Entity title",
        dataType: "plaintext",
      };
      check(
        titleFieldDef,
        "**Title** (plaintext)\n\nEntity title\n\n**From:** Project (relation)",
        undefined,
        mockProjectField,
      );
    });
  });

  describe("template hover", () => {
    const check = (input: TemplateHoverInput, expected: string) => {
      expect(renderHoverContent(input)).toBe(expected);
    };

    it("renders template with name", () => {
      check(
        {
          kind: "template",
          templateKey: "my-template",
          templateName: "My Template",
        },
        "**My Template** (template)",
      );
    });

    it("renders template with key only when no name", () => {
      check(
        { kind: "template", templateKey: "__document__" },
        "**__document__** (template)",
      );
    });

    it("renders template with description", () => {
      check(
        {
          kind: "template",
          templateKey: "task-detail",
          templateName: "Task Detail",
          templateDescription: "Displays task information in detail view",
        },
        "**Task Detail** (template)\n\nDisplays task information in detail view",
      );
    });

    it("renders template with name and description", () => {
      check(
        {
          kind: "template",
          templateKey: "project-summary",
          templateName: "Project Summary",
          templateDescription: "Overview of project status",
          templateFormat: "section",
        },
        "**Project Summary** (template)\n\nOverview of project status",
      );
    });
  });
});
