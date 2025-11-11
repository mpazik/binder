import { describe, expect, it } from "bun:test";
import { mockNodeSchema } from "@binder/db/mocks";
import {
  type ConfigId,
  type ConfigKey,
  type ConfigUid,
  fieldConfigType,
  type NodeFieldDefinition,
  type NodeSchema,
} from "@binder/db";
import { renderSchemaPreview } from "./schema-preview.ts";

describe("renderSchemaPreview", () => {
  const result = renderSchemaPreview(mockNodeSchema);

  it("should render complete schema with fields and types sections", () => {
    expect(result).toContain("FIELDS:");
    expect(result).toContain("TYPES:");
  });

  it("should render field with basic string type", () => {
    expect(result).toContain("• name: string");
    expect(result).toContain("• title: string");
  });

  it("should render field with description", () => {
    expect(result).toContain("• description: text - Detailed description");
    expect(result).toContain("• dueDate: date - When task is due");
  });

  it("should render option field with available options", () => {
    expect(result).toContain(
      "• status: todo|in_progress|done|archived - Current state",
    );
  });

  it("should render relation field with single target type", () => {
    expect(result).toContain("• project: Project - Part of project");
  });

  it("should render relation field with multiple target types", () => {
    expect(result).toContain("• assignedTo: User|Team - Responsible party");
  });

  it("should render relation field with array of single type", () => {
    expect(result).toContain("• tasks: Task[] - Related tasks");
    expect(result).toContain("• members: User[] - Team members");
  });

  it("should render relation field with array of multiple types", () => {
    expect(result).toContain(
      "• owners: (User|Team)[] - Multiple responsible parties",
    );
  });

  it("should render array of primitives", () => {
    expect(result).toContain("• tags: string[] - Category labels");
  });

  it("should render boolean field", () => {
    expect(result).toContain("• favorite: boolean - Favorite item");
  });

  it("should render types with inheritance", () => {
    expect(result).toContain("• Task <WorkItem> - Individual unit of work");
    expect(result).toContain(
      "• Project <WorkItem> - Container for related tasks",
    );
  });

  it("should render types with field constraints", () => {
    expect(result).toContain("title{required}");
    expect(result).toContain("status{default: todo}");
  });

  it("should render multi-line format for complex types", () => {
    // WorkItem has 5 fields + constraints, should use multi-line
    expect(result).toContain(
      "• WorkItem - Actionable item [\n    title{required}",
    );
  });

  it("should render single-line format for simple types", () => {
    const result = renderSchemaPreview(mockNodeSchema);
    expect(result).toContain(
      `• User - Individual user account [name{required, description: "Full name"}, email]\n`,
    );
  });

  it("should render field constraint attributes", () => {
    const result = renderSchemaPreview(mockNodeSchema);

    expect(result).toContain("title{required}");
    expect(result).toContain("status{default: todo}");
    expect(result).toContain("members{min: 1}");
    expect(result).toContain('name{required, description: "Full name"}');
  });

  it("should render only and exclude constraints", () => {
    const result = renderSchemaPreview(mockNodeSchema);

    expect(result).toContain("assignedTo{only: User}");
    expect(result).toContain("status{exclude: archived}");
  });

  it("should handle empty schema", () => {
    const emptySchema: NodeSchema = {
      fields: {},
      types: {},
    };

    const result = renderSchemaPreview(emptySchema);

    expect(result).toContain("FIELDS:");
    expect(result).toContain("TYPES:");
  });

  describe("field helper", () => {
    const field = (
      key: string,
      dataType: NodeFieldDefinition["dataType"],
      opts?: Partial<NodeFieldDefinition>,
    ): NodeFieldDefinition => ({
      id: 1 as ConfigId,
      key,
      uid: "fld001" as ConfigUid,
      type: fieldConfigType,
      name: key,
      dataType,
      ...opts,
    });

    const check = (
      key: string,
      dataType: NodeFieldDefinition["dataType"],
      opts: Partial<NodeFieldDefinition> | undefined,
      expected: string,
    ) => {
      const result = renderSchemaPreview({
        fields: {
          [key as ConfigKey]: {
            id: 1 as ConfigId,
            key,
            uid: "fld001" as ConfigUid,
            type: fieldConfigType,
            name: key,
            dataType,
            ...opts,
          },
        },
        types: {},
      });

      expect(result).toContain(expected);
    };

    it("should handle option field without options array", () => {
      check("brokenStatus", "option", undefined, "• brokenStatus: option");
    });

    it("should handle option field with empty options array", () => {
      check("emptyStatus", "option", { options: [] }, "• emptyStatus: option");
    });

    it("should handle multi-select option field", () => {
      check(
        "tags",
        "option",
        {
          allowMultiple: true,
          options: [
            { key: "urgent", name: "Urgent" },
            { key: "important", name: "Important" },
            { key: "low", name: "Low" },
          ],
        },
        "• tags: (urgent|important|low)[]",
      );
    });

    it("should handle single option in option field", () => {
      check(
        "singleOption",
        "option",
        {
          options: [{ key: "only", name: "Only" }],
        },
        "• singleOption: only",
      );
    });

    it("should handle multi-select with single option", () => {
      check(
        "multiSingle",
        "option",
        {
          allowMultiple: true,
          options: [{ key: "only", name: "Only" }],
        },
        "• multiSingle: only[]",
      );
    });
  });
});
