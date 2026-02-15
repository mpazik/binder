import { describe, expect, it } from "bun:test";
import { mockRecordSchema } from "@binder/db/mocks";
import {
  type ConfigId,
  type ConfigKey,
  type ConfigUid,
  fieldSystemType,
  type RecordFieldDef,
  type RecordSchema,
} from "@binder/db";
import { renderSchemaPreview } from "./schema-preview.ts";

describe("renderSchemaPreview", () => {
  const result = renderSchemaPreview(mockRecordSchema);

  it("should render complete schema with fields and types sections", () => {
    expect(result).toContain("FIELDS:");
    expect(result).toContain("TYPES:");
  });

  it("should render field with basic plaintext type", () => {
    expect(result).toContain("• email: plaintext");
    expect(result).toContain("• role: plaintext");
  });

  it("should render field with description", () => {
    expect(result).toContain("• dueDate: date - When task is due");
  });

  it("should render option field with available options", () => {
    expect(result).toContain(
      "• status: pending|active|complete|cancelled|archived - Current state",
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
    expect(result).toContain("• tags: plaintext[] - Category labels");
  });

  it("should render boolean field", () => {
    expect(result).toContain("• favorite: boolean - Favorite item");
  });

  it("should render types without inheritance", () => {
    expect(result).toContain("• Task - Individual unit of work");
    expect(result).toContain("• Project - Container for related tasks");
  });

  it("should render types with field constraints", () => {
    expect(result).toContain("title{required}");
    expect(result).toContain("status{exclude: archived}");
  });

  it("should render multi-line format for complex types", () => {
    // Task has 6 fields + constraints, should use multi-line
    expect(result).toContain(
      "• Task - Individual unit of work [\n    title{required}",
    );
  });

  it("should render single-line format for simple types", () => {
    const result = renderSchemaPreview(mockRecordSchema);
    expect(result).toContain(
      `• User - Individual user account [name{required, description: "Full name"}, email]\n`,
    );
  });

  it("should render field constraint attributes", () => {
    const result = renderSchemaPreview(mockRecordSchema);

    expect(result).toContain("title{required}");
    expect(result).toContain("status{exclude: archived}");
    expect(result).toContain("members{min: 1}");
    expect(result).toContain('name{required, description: "Full name"}');
  });

  it("should render only and exclude constraints", () => {
    const result = renderSchemaPreview(mockRecordSchema);

    expect(result).toContain("assignedTo{only: User}");
    expect(result).toContain("status{exclude: archived}");
  });

  it("should render when constraint", () => {
    const result = renderSchemaPreview(mockRecordSchema);

    expect(result).toContain("completedAt: datetime {when: status=complete}");
  });

  it("should handle empty schema", () => {
    const emptySchema: RecordSchema = {
      fields: {},
      types: {},
    };

    const result = renderSchemaPreview(emptySchema);

    expect(result).toContain("FIELDS:");
    expect(result).toContain("TYPES:");
  });

  describe("field helper", () => {
    const check = (
      key: string,
      dataType: RecordFieldDef["dataType"],
      opts: Partial<RecordFieldDef> | undefined,
      expected: string,
    ) => {
      const result = renderSchemaPreview({
        fields: {
          [key]: {
            id: 1 as ConfigId,
            key: key as ConfigKey,
            uid: "fld001" as ConfigUid,
            type: fieldSystemType,
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
