import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { $ } from "bun";
import { expect } from "bun:test";
import { stringify } from "yaml";
import { omit } from "@binder/utils";
import {
  mockStatusField,
  mockPriorityField,
  mockAssignedToField,
  mockProjectField,
  mockTasksField,
  mockDueDateField,
  mockEmailField,
  mockRoleField,
  mockOwnersField,
  mockMembersField,
  mockFavoriteField,
  mockCompletedAtField,
  mockCancelReasonField,
  mockPartnerField,
  mockRelatedToField,
  mockTaskType,
  mockProjectType,
  mockUserType,
  mockTeamType,
  mockTask1Record,
  mockTask2Record,
  mockTask3Record,
  mockProjectRecord,
  mockUserRecord,
  mockUser2Record,
} from "@binder/db/mocks";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const CLI_ENTRY = resolve(REPO_ROOT, "packages/cli/src/index.ts");
const DEFAULT_CMD = ["bun", "run", CLI_ENTRY];

const getCommand = (): string[] => {
  const env = process.env.BINDER_CLI;
  if (!env) return DEFAULT_CMD;
  const parts = env.trim().split(/\s+/);
  if (parts.length === 1 && parts[0] === "binder") {
    // eslint-disable-next-line no-restricted-syntax
    throw new Error(
      "BINDER_CLI=binder would run the globally installed binary. Use an explicit path or unset BINDER_CLI to use the dev entrypoint.",
    );
  }
  return parts;
};

const CMD = getCommand();

/** `.binder` when testing a bundled binary, `.binder-dev` when running unbundled via Bun. */
export const binderDir = process.env.BINDER_CLI ? ".binder" : ".binder-dev";

export const run = async (
  args: string[],
  opts?: {
    cwd?: string;
    env?: Record<string, string | undefined>;
  },
) => {
  const result = await $`${CMD} ${args}`
    .cwd(opts?.cwd ?? process.cwd())
    .env({ ...process.env, ...(opts?.env ?? {}) })
    .nothrow()
    .quiet();
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode,
  };
};

type StreamAssertion = string | string[] | ((output: string) => void);
type OutputAssertion =
  | StreamAssertion
  | { stdout?: StreamAssertion; stderr?: StreamAssertion };

const assertStream = (output: string, contains: StreamAssertion) => {
  if (typeof contains === "function") {
    contains(output);
  } else if (Array.isArray(contains)) {
    for (const s of contains) expect(output).toContain(s);
  } else {
    expect(output).toContain(contains);
  }
};

const isStreamPair = (
  v: OutputAssertion,
): v is { stdout?: StreamAssertion; stderr?: StreamAssertion } =>
  typeof v === "object" && !Array.isArray(v) && typeof v !== "function";

const assertOutput = (
  result: { stdout: string; stderr: string },
  contains: OutputAssertion,
) => {
  if (isStreamPair(contains)) {
    if (contains.stdout) assertStream(result.stdout, contains.stdout);
    if (contains.stderr) assertStream(result.stderr, contains.stderr);
  } else {
    assertStream(result.stdout + result.stderr, contains);
  }
};

/** Creates `check` and `checkError` helpers bound to a workspace directory. */
export const createRunHelpers = (getDir: () => string) => {
  const check = async (args: string[], contains?: OutputAssertion) => {
    const result = await run(args, { cwd: getDir() });
    expect(result.exitCode).toBe(0);
    if (contains) assertOutput(result, contains);
  };

  const checkError = async (args: string[], contains?: OutputAssertion) => {
    const result = await run(args, { cwd: getDir() });
    expect(result.exitCode).not.toBe(0);
    if (contains) assertOutput(result, contains);
  };

  return { check, checkError };
};

/** The caller is responsible for killing the returned process. */
export const spawnBinder = (
  command: string,
  opts?: { cwd?: string; env?: Record<string, string | undefined> },
): ChildProcess => {
  const [bin, ...baseArgs] = CMD;
  return spawn(bin, [...baseArgs, command], {
    cwd: opts?.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...(opts?.env ?? {}) },
  });
};

const stripIds = (entity: Record<string, unknown>): Record<string, unknown> =>
  omit(entity, ["id", "uid"]);

const SEED_RECORDS = [
  mockProjectRecord,
  mockTask1Record,
  mockTask2Record,
  mockTask3Record,
  mockUserRecord,
  mockUser2Record,
];

const buildUidToKeyMap = (
  records: Record<string, unknown>[],
): Map<string, string> => {
  const map = new Map<string, string>();
  for (const r of records) {
    if (typeof r.uid === "string" && typeof r.key === "string") {
      map.set(r.uid, r.key);
    }
  }
  return map;
};

const replaceUidsWithKeys = (
  record: Record<string, unknown>,
  uidToKey: Map<string, string>,
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(record)) {
    if (typeof value === "string" && uidToKey.has(value)) {
      result[field] = uidToKey.get(value);
    } else if (Array.isArray(value)) {
      result[field] = value.map((v) =>
        typeof v === "string" && uidToKey.has(v) ? uidToKey.get(v) : v,
      );
    } else {
      result[field] = value;
    }
  }
  return result;
};

const SEED_FIELDS = [
  mockStatusField,
  mockPriorityField,
  mockAssignedToField,
  mockProjectField,
  mockTasksField,
  mockDueDateField,
  mockEmailField,
  mockRoleField,
  mockOwnersField,
  mockMembersField,
  mockFavoriteField,
  mockCompletedAtField,
  mockCancelReasonField,
  mockPartnerField,
  mockRelatedToField,
];

const SEED_TYPES = [mockTaskType, mockProjectType, mockUserType, mockTeamType];

const SEED_VIEWS = [
  {
    key: "task-view",
    type: "View",
    name: "Task view",
    viewContent: "# {title}\n\n{description}\n",
  },
];

const NAVIGATION_CONFIGS = [
  {
    key: "nav-tasks",
    type: "Navigation",
    path: "tasks/{key}",
    where: { type: "Task" },
    view: "document",
  },
  {
    key: "nav-tasks-yaml",
    type: "Navigation",
    path: "tasks-yaml/{key}",
    where: { type: "Task" },
    includes: {
      key: true,
      title: true,
      status: true,
      priority: true,
      description: true,
    },
  },
  {
    key: "nav-projects",
    type: "Navigation",
    path: "projects/{key}",
    where: { type: "Project" },
    view: "document",
  },
  {
    key: "nav-teams-yaml",
    type: "Navigation",
    path: "teams/{key}",
    where: { type: "Team" },
    includes: {
      key: true,
      members: true,
    },
  },
  {
    key: "nav-teams-md",
    type: "Navigation",
    path: "teams-md/{key}",
    where: { type: "Team" },
    view: "document",
  },
];

const buildSchemaTransaction = (opts?: { docs?: boolean }) => [
  {
    author: "test",
    configs: [
      ...SEED_FIELDS,
      ...SEED_TYPES,
      ...(opts?.docs ? [...SEED_VIEWS, ...NAVIGATION_CONFIGS] : []),
    ].map(stripIds),
  },
];

const buildRecordsTransaction = () => {
  const uidToKey = buildUidToKeyMap(SEED_RECORDS);
  return [
    {
      author: "test",
      records: SEED_RECORDS.map((r) =>
        replaceUidsWithKeys(stripIds(r), uidToKey),
      ),
    },
  ];
};

type SetupOptions = {
  docs?: boolean;
};

const runOrThrow = async (
  label: string,
  args: string[],
  cwd: { cwd: string },
) => {
  const result = await run(args, cwd);
  if (result.exitCode !== 0) {
    // eslint-disable-next-line no-restricted-syntax
    throw new Error(
      `${label} failed (exit ${result.exitCode}): ${result.stderr}`,
    );
  }
};

export const setupWorkspace = async (opts?: SetupOptions): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "binder-e2e-"));
  const cwd = { cwd: dir };

  const initArgs = ["init", "--blueprint", "none", "--author", "test", "-q"];
  if (opts?.docs) initArgs.push("--docs-path", "docs");
  await runOrThrow("binder init", initArgs, cwd);

  const schemaFile = join(dir, "seed-schema.yaml");
  await writeFile(schemaFile, stringify(buildSchemaTransaction(opts)));
  await runOrThrow("schema import", ["tx", "import", schemaFile, "-q"], cwd);

  const recordsFile = join(dir, "seed-records.yaml");
  await writeFile(recordsFile, stringify(buildRecordsTransaction()));
  await runOrThrow("records import", ["tx", "import", recordsFile, "-q"], cwd);

  return dir;
};

export const teardownWorkspace = (dir: string): Promise<void> =>
  rm(dir, { recursive: true, force: true });
