import { describe, expect, it } from "bun:test";
import { type FieldsetNested } from "@binder/db";
import {
  mockRecordSchema,
  mockProjectRecord,
  mockTask1Record,
} from "@binder/db/mocks";
import { omit, pick } from "@binder/utils";
import { computeMatchScore, type ScorerConfig } from "./similarity-scorer.ts";
import { classifyFields } from "./field-classifier.ts";

describe("computeMatchScore", () => {
  const schema = mockRecordSchema;
  const classifications = classifyFields(schema);
  const defaultListLength = 10;

  const task = pick(mockTask1Record, [
    "type",
    "title",
    "description",
    "status",
    "priority",
    "tags",
  ]);
  const project = pick(mockProjectRecord, [
    "type",
    "title",
    "description",
    "status",
  ]);

  const score = (
    target: FieldsetNested & { position?: number },
    candidate: FieldsetNested & { position?: number },
    config: Pick<ScorerConfig, "listLength" | "excludeFields">,
  ): number => {
    const { position: targetPos, ...targetFieldset } = target;
    const { position: candidatePos, ...candidateFieldset } = candidate;
    return computeMatchScore(
      {
        schema,
        classifications,
        ...config,
      },
      targetFieldset,
      candidateFieldset,
      targetPos ?? 0,
      candidatePos ?? 0,
    );
  };

  const check = (
    target: FieldsetNested & { position?: number },
    betterMatch: FieldsetNested & { position?: number },
    worseMatch: FieldsetNested & { position?: number },
    options: {
      listLength?: number;
      match?: "greater" | "equal";
      excludeFields?: Set<string>;
    } = {},
  ) => {
    const { listLength = defaultListLength, excludeFields } = options;
    const config = { listLength, excludeFields };
    if (options.match === "equal") {
      expect(score(target, betterMatch, config)).toBeCloseTo(
        score(target, worseMatch, config),
        5,
      );
    } else {
      expect(score(target, betterMatch, config)).toBeGreaterThan(
        score(target, worseMatch, config),
      );
    }
  };

  const checkSign = (
    target: FieldsetNested & { position?: number },
    candidate: FieldsetNested & { position?: number },
    sign: "positive" | "negative",
    listLength = defaultListLength,
  ) => {
    const s = score(target, candidate, { listLength });
    if (sign === "positive") {
      expect(s).toBeGreaterThan(0);
    } else {
      expect(s).toBeLessThan(0);
    }
  };

  const checkScore = (
    target: FieldsetNested & { position?: number },
    candidate: FieldsetNested & { position?: number },
    expected: number,
    precision = 0,
  ) => {
    expect(
      score(target, candidate, { listLength: defaultListLength }),
    ).toBeCloseTo(expected, precision);
  };

  describe("field strength", () => {
    it("title > status", () => {
      check(
        task,
        { ...task, status: "active" },
        { ...task, title: "Different task" },
      );
    });

    it("title > status + priority", () => {
      check(
        task,
        { ...task, status: "active", priority: "high" },
        { ...task, title: "Different" },
      );
    });

    it("partial title > exact status", () => {
      check(
        task,
        {
          ...task,
          title: "Implement user authentication system",
          status: "active",
        },
        { ...task, title: "Build API endpoints" },
      );
    });

    it("single type change > multiple field changes", () => {
      check(
        task,
        { ...task, type: "Project" },
        { ...task, title: "Changed", status: "active", description: "New" },
      );
    });

    it("similar type names get no partial credit (categorical exact match)", () => {
      const similarType = { ...task, type: "Tasks" };
      const differentType = { ...task, type: "Project" };
      check(task, similarType, differentType, { match: "equal" });
    });
  });

  describe("position vs content", () => {
    it("exact content at pos=5 > status change at pos=0", () => {
      check(
        task,
        { ...task, position: 5 },
        { ...task, status: "active", position: 0 },
      );
    });

    it("exact content at pos=3 > title change at pos=0", () => {
      check(
        task,
        { ...task, position: 3 },
        { ...task, title: "Different", position: 0 },
      );
    });

    it("position penalty scales with list length", () => {
      const moved = { ...task, position: 1 };
      expect(score(task, moved, { listLength: 5 })).toBeLessThan(
        score(task, moved, { listLength: 100 }),
      );
    });
  });

  describe("missing fields", () => {
    const taskWithoutDesc = omit(task, ["description"]);
    const taskWithoutDescStatus = omit(task, ["description", "status"]);

    it("more fields with one mismatch > fewer matching fields", () => {
      check(task, { ...task, title: "Different" }, taskWithoutDescStatus);
    });

    it("all fields matching > subset of fields matching", () => {
      check(task, task, taskWithoutDesc);
    });

    it("6 matching fields > 5 matching fields", () => {
      check(task, taskWithoutDesc, taskWithoutDescStatus);
    });

    it("empty array = mismatched array (jaccard=0)", () => {
      check(
        task,
        { ...task, tags: [] },
        { ...task, tags: ["unrelated", "stuff"] },
        { match: "equal" },
      );
    });
  });

  describe("text similarity", () => {
    it("similar long text > completely different text", () => {
      const updatedDescription =
        task.description.replace("JWT", "OAuth") +
        "Users should be able to sign up with email and password. " +
        "Implement password reset via email link.";

      const similar = {
        ...task,
        description: updatedDescription,
      };
      const different = {
        ...task,
        description: "Unrelated task about database migrations",
      };
      check(task, similar, different);
    });

    it("minor typo > status change", () => {
      check(
        task,
        { ...task, title: "Implment user authentication" },
        { ...task, status: "active" },
      );
    });

    it("description change penalizes more than title change (richtext has lower u)", () => {
      check(
        task,
        { ...task, title: "Completely new title" },
        { ...task, description: "Completely new description" },
      );
    });

    it("higher text similarity scores higher after quadratic scaling", () => {
      const highSim = {
        ...task,
        title: "Implement user authentication system",
      };
      const medSim = { ...task, title: "Implement user login" };
      const lowSim = { ...task, title: "Setup database" };
      check(task, highSim, medSim);
      check(task, medSim, lowSim);
    });

    it("text similarities below 0.1 threshold are treated equally", () => {
      const desc1 = {
        ...task,
        description: "Configure PostgreSQL database with proper indexing",
      };
      const desc2 = {
        ...task,
        description: "Setup Redis cache for session management system",
      };
      check(task, desc1, desc2, { match: "equal" });
    });
  });

  describe("score baselines", () => {
    it("exact match", () => checkScore(task, task, 48.7));
    it("complete mismatch", () => checkScore(task, project, -7.6));
    it("title change", () =>
      checkScore(task, { ...task, title: "Different task" }, 34.3));
    it("status change", () =>
      checkScore(task, { ...task, status: "active" }, 45.4));
    it("type change", () =>
      checkScore(task, { ...task, type: "Project" }, 40.5));
    it("position 0->5", () =>
      checkScore({ ...task, position: 0 }, { ...task, position: 5 }, 46.6));
    it("edited and moved", () => {
      checkScore(
        { ...task, position: 0 },
        { ...task, title: "Implement OAuth", status: "active", position: 3 },
        32.0,
      );
    });
    // Type match alone is not enough - need partial content similarity to reach the threshold
    it("near threshold - type match with weak title similarity", () => {
      checkScore(
        task,
        {
          type: "Task",
          title: "Implement login feature", // weak match with "Implement user auth"
          description: "Configure PostgreSQL with proper indexing",
          status: "active",
          priority: "high",
          tags: ["devops"],
        },
        -1.0,
      );
    });
  });

  describe("full record with identity fields", () => {
    const fullTask = omit(mockTask1Record, ["uid"]);

    it("exact match with id and key", () => {
      checkSign(fullTask, fullTask, "positive");
    });
  });

  describe("listLength edge cases", () => {
    it("listLength=1 produces positive score for exact match", () => {
      checkSign(task, task, "positive", 1);
    });

    it("completely different records produce negative score with listLength=1", () => {
      const differentRecord = omit(mockProjectRecord, ["uid"]);
      checkSign(task, differentRecord, "negative", 1);
    });
  });

  describe("ambiguous matching scenarios", () => {
    it("fuzzy title match beats exact status+priority match", () => {
      const target = { ...task, title: "Implement user authentication" };
      const fuzzyTitleMatch = {
        ...target,
        status: "active",
        priority: "high",
      };
      const exactLowValueFields = {
        ...task,
        title: "Completely unrelated task name",
        status: "pending",
        priority: "medium",
      };
      check(target, fuzzyTitleMatch, exactLowValueFields);
    });

    it("missing field scores higher than completely mismatched field", () => {
      const missingDesc = omit(task, ["description"]);
      const mismatchedDesc = {
        ...task,
        description:
          "Completely different description about database migrations",
      };
      check(task, missingDesc, mismatchedDesc);
    });

    it("extreme position change beats content mismatch", () => {
      check(
        { ...task, position: 0 },
        { ...task, position: 49 },
        { ...task, title: "Different task", position: 0 },
        { listLength: 50 },
      );
    });

    it("accumulated partial changes beat fresh record", () => {
      const evolved = {
        type: "Task",
        title: "Implement user auth system",
        description: "Add login and registration with OAuth tokens",
        status: "active",
        priority: "high",
        tags: ["urgent"],
        position: 2,
      };
      const freshRecord = {
        type: "Task",
        title: "Setup CI/CD pipeline",
        description: "Configure GitHub Actions for automated testing",
        status: "pending",
        priority: "medium",
        tags: ["devops"],
        position: 0,
      };
      check({ ...task, position: 0 }, evolved, freshRecord);
    });
  });

  describe("nested relation fields - single relation", () => {
    it("matching UIDs on both sides scores high", () => {
      const taskWithProject = {
        ...task,
        project: { uid: "proj-1", title: "Alpha", status: "active" },
      };
      const taskWithSameProject = {
        ...task,
        project: { uid: "proj-1", title: "Alpha Renamed", status: "complete" },
      };
      const taskWithDifferentProject = {
        ...task,
        project: { uid: "proj-2", title: "Alpha", status: "active" },
      };
      check(taskWithProject, taskWithSameProject, taskWithDifferentProject);
    });

    it("different UIDs penalizes more than missing field", () => {
      const taskA = {
        ...task,
        project: { uid: "proj-1", title: "Alpha" },
      };
      const taskB = {
        ...task,
        project: { uid: "proj-2", title: "Alpha" },
      };
      check(taskA, task, taskB);
    });

    it("one missing UID falls back to content comparison", () => {
      const taskWithUid = {
        ...task,
        project: { uid: "proj-1", title: "Alpha Project", status: "active" },
      };
      const taskWithoutUid = {
        ...task,
        project: { title: "Alpha Project", status: "active" },
      };
      const taskWithDifferentContent = {
        ...task,
        project: { title: "Beta Project", status: "complete" },
      };
      check(taskWithUid, taskWithoutUid, taskWithDifferentContent);
    });

    it("both missing UIDs compares by nested content", () => {
      const taskA = {
        ...task,
        project: { title: "Alpha", status: "active" },
      };
      const taskSimilar = {
        ...task,
        project: { title: "Alpha", status: "complete" },
      };
      const taskDifferent = {
        ...task,
        project: { title: "Beta", status: "pending" },
      };
      check(taskA, taskSimilar, taskDifferent);
    });

    it("mixed string UID and nested object extracts UID", () => {
      const taskWithStringRef = { ...task, project: "proj-1" };
      const taskWithNestedRef = {
        ...task,
        project: { uid: "proj-1", title: "Alpha" },
      };
      const taskWithDifferentRef = {
        ...task,
        project: { uid: "proj-2", title: "Alpha" },
      };
      check(taskWithStringRef, taskWithNestedRef, taskWithDifferentRef);
    });
  });

  describe("nested relation fields - multi relation", () => {
    it("arrays with matching UIDs score high", () => {
      const projectA = {
        ...project,
        tasks: [
          { uid: "task-1", title: "First", status: "pending" },
          { uid: "task-2", title: "Second", status: "active" },
        ],
      };
      const projectSimilar = {
        ...project,
        tasks: [
          { uid: "task-1", title: "First Updated", status: "complete" },
          { uid: "task-2", title: "Second", status: "active" },
        ],
      };
      const projectDifferent = {
        ...project,
        tasks: [
          { uid: "task-3", title: "First", status: "pending" },
          { uid: "task-4", title: "Second", status: "active" },
        ],
      };
      check(projectA, projectSimilar, projectDifferent);
    });

    it("arrays with partial UID overlap scores between full match and no match", () => {
      const projectA = {
        ...project,
        tasks: [{ uid: "task-1" }, { uid: "task-2" }],
      };
      const projectPartial = {
        ...project,
        tasks: [{ uid: "task-1" }, { uid: "task-3" }],
      };
      const projectNoMatch = {
        ...project,
        tasks: [{ uid: "task-4" }, { uid: "task-5" }],
      };
      check(projectA, projectPartial, projectNoMatch);
    });

    it("arrays without UIDs uses auction matching on content", () => {
      const projectA = {
        ...project,
        tasks: [
          { title: "Implement auth", status: "pending" },
          { title: "Add tests", status: "active" },
        ],
      };
      const projectReordered = {
        ...project,
        tasks: [
          { title: "Add tests", status: "complete" },
          { title: "Implement authentication", status: "pending" },
        ],
      };
      const projectDifferent = {
        ...project,
        tasks: [
          { title: "Setup database", status: "pending" },
          { title: "Configure CI/CD", status: "active" },
        ],
      };
      check(projectA, projectReordered, projectDifferent);
    });

    it("empty arrays match each other", () => {
      const projectEmpty1 = { ...project, tasks: [] };
      const projectEmpty2 = { ...project, tasks: [] };
      const projectWithTasks = {
        ...project,
        tasks: [{ uid: "task-1", title: "First" }],
      };
      check(projectEmpty1, projectEmpty2, projectWithTasks);
    });

    it("mixed UID and non-UID items in arrays", () => {
      const projectA = {
        ...project,
        tasks: [
          { uid: "task-1", title: "First" },
          { uid: "", title: "Anonymous task" },
        ],
      };
      const projectSimilar = {
        ...project,
        tasks: [
          { uid: "task-1", title: "First Updated" },
          { uid: "", title: "Anonymous task edited" },
        ],
      };
      const projectDifferent = {
        ...project,
        tasks: [
          { uid: "task-2", title: "Different" },
          { uid: "", title: "Completely different" },
        ],
      };
      check(projectA, projectSimilar, projectDifferent);
    });

    it("arrays of plain UID strings compare by jaccard similarity", () => {
      const projectA = {
        ...project,
        tasks: ["task-1", "task-2", "task-3"],
      };
      const projectSimilar = {
        ...project,
        tasks: ["task-1", "task-2", "task-4"],
      };
      const projectDifferent = {
        ...project,
        tasks: ["task-5", "task-6", "task-7"],
      };
      check(projectA, projectSimilar, projectDifferent);
    });

    it("mixed nested objects and plain UID strings extracts UIDs for comparison", () => {
      const projectWithNested = {
        ...project,
        tasks: [
          { uid: "task-1", title: "First" },
          { uid: "task-2", title: "Second" },
        ],
      };
      const projectWithStrings = {
        ...project,
        tasks: ["task-1", "task-2"],
      };
      const projectDifferentStrings = {
        ...project,
        tasks: ["task-3", "task-4"],
      };
      check(projectWithNested, projectWithStrings, projectDifferentStrings);
    });
  });

  describe("excluded fields", () => {
    it("differing excluded field scores same as matching field", () => {
      const sameStatus = { ...task, status: "pending" };
      const differentStatus = { ...task, status: "active" };
      check(task, sameStatus, differentStatus, {
        excludeFields: new Set(["status"]),
        match: "equal",
      });
    });
  });
});
