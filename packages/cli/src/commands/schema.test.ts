import * as YAML from "yaml";
import { beforeEach, describe, expect, it } from "bun:test";
import { throwIfError } from "@binder/utils";
import "@binder/utils/tests";
import { mockTransactionInitInput } from "@binder/db/mocks";
import type { EntityKey, EntityType, NamespaceEditable } from "@binder/db";
import { createMockRuntimeContextWithDb } from "../runtime.mock.ts";
import type { RuntimeContextWithDb } from "../runtime.ts";
import { createUi, type Ui } from "../cli/ui.ts";
import type { SerializeItemFormat } from "../utils/serialize.ts";
import { schemaHandler } from "./schema.ts";

describe("schemaHandler", () => {
  let ctx: RuntimeContextWithDb;

  beforeEach(async () => {
    ctx = await createMockRuntimeContextWithDb();
    throwIfError(await ctx.kg.update(mockTransactionInitInput));
  });

  const createCapturingUi = (quiet: boolean): { ui: Ui; output: string[] } => {
    const output: string[] = [];
    const realUi = createUi({ quiet });

    return {
      output,
      ui: {
        ...realUi,
        println: quiet
          ? realUi.println
          : (...msg: string[]) => output.push(msg.join(" ")),
        print: quiet
          ? realUi.print
          : (...msg: string[]) => output.push(msg.join(" ")),
        printData: (data: unknown, format?: string) => {
          output.push(
            format === "json"
              ? JSON.stringify(data, null, 2)
              : format === "yaml"
                ? YAML.stringify(data)
                : String(data),
          );
        },
      },
    };
  };

  const run = async (args: {
    namespace?: NamespaceEditable;
    typeKeys?: EntityType[];
    types?: EntityType[];
    fields?: EntityKey[];
    format?: SerializeItemFormat;
  }) => {
    const { ui, output } = createCapturingUi(!!args.format);

    const result = await schemaHandler({
      ...ctx,
      ui,
      args: { namespace: args.namespace ?? "record", ...args },
    });

    return { result, output: output.join("") };
  };

  describe("--format json", () => {
    const check = async (
      args: {
        typeKeys?: EntityType[];
        types?: EntityType[];
        fields?: EntityKey[];
      },
      expected: { types: string[]; fields?: string[] },
    ) => {
      const { result, output } = await run({ format: "json", ...args });
      expect(result).toBeOk();
      const parsed = JSON.parse(output);
      expect(Object.keys(parsed.types).sort()).toEqual(expected.types.sort());
      if (expected.fields) {
        expect(Object.keys(parsed.fields).sort()).toEqual(
          expected.fields.sort(),
        );
      }
      return parsed;
    };

    const checkError = async (
      args: { typeKeys?: EntityType[]; fields?: EntityKey[] },
      expected: { errorKey: string; message: string; suggestion: string },
    ) => {
      const { result } = await run({ format: "json", ...args });
      expect(result).toBeErrWithKey(expected.errorKey);
      if (!result.error) return;
      expect(result.error.message).toContain(expected.message);
      expect(result.error.suggestion).toContain(expected.suggestion);
    };

    it("outputs valid JSON with fields and types", async () => {
      const { result, output } = await run({ format: "json" });
      expect(result).toBeOk();
      const parsed = JSON.parse(output);
      expect(Object.keys(parsed.fields).length).toBeGreaterThan(0);
      expect(Object.keys(parsed.types).length).toBeGreaterThan(0);
    });

    it("filters to specified types", async () => {
      const parsed = await check(
        { types: ["Task" as EntityType] },
        { types: ["Task"] },
      );
      expect(Object.keys(parsed.fields).length).toBeGreaterThan(0);
    });

    it("merges positional type keys and --types", async () => {
      await check(
        {
          typeKeys: ["Task" as EntityType],
          types: ["Project" as EntityType],
        },
        { types: ["Project", "Task"] },
      );
    });

    it("filters to selected field across matching types", async () => {
      await check(
        { fields: ["status" as EntityKey] },
        { types: ["Task", "Project"], fields: ["status"] },
      );
    });

    it("filters by type and field", async () => {
      await check(
        {
          typeKeys: ["Task" as EntityType],
          fields: ["status" as EntityKey],
        },
        { types: ["Task"], fields: ["status"] },
      );
    });

    it("errors on unknown type key with suggestion", async () => {
      await checkError(
        { typeKeys: ["Taskk" as EntityType] },
        {
          errorKey: "unknown-type-key",
          message: "Unknown type key: Taskk",
          suggestion: "Task",
        },
      );
    });

    it("errors on unknown field key with suggestion", async () => {
      await checkError(
        { fields: ["statsu" as EntityKey] },
        {
          errorKey: "unknown-field-key",
          message: "Unknown field key: statsu",
          suggestion: "status",
        },
      );
    });
  });

  describe("--format yaml", () => {
    it("outputs valid YAML with fields and types", async () => {
      const { result, output } = await run({ format: "yaml" });

      expect(result).toBeOk();
      const parsed = YAML.parse(output);
      expect(Object.keys(parsed.fields).length).toBeGreaterThan(0);
      expect(Object.keys(parsed.types).length).toBeGreaterThan(0);
    });
  });

  describe("no format", () => {
    it("renders human-readable preview", async () => {
      const { result, output } = await run({});

      expect(result).toBeOk();
      expect(output).toContain("FIELDS:");
      expect(output).toContain("TYPES:");
      expect(() => JSON.parse(output)).toThrow();
    });
  });
});
