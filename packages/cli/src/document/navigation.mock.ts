import {
  changesetInputForNewEntity,
  type ConfigKey,
  type ConfigUid,
  type Fieldset,
  newConfigAppId,
} from "@binder/repo";
import { typeNavigationKey, typeViewKey } from "../cli-config-schema.ts";

export const mockNav1Key = "nav-projects" as ConfigKey;

export const mockNav1Entity = {
  id: newConfigAppId(0),
  uid: "_navRoot000" as ConfigUid,
  key: mockNav1Key,
  type: typeNavigationKey,
  path: "projects/{title}/",
  where: { type: "Project" },
} as const satisfies Fieldset;

export const mockNav2Entity = {
  id: newConfigAppId(1),
  uid: "_navChild00" as ConfigUid,
  key: "nav-project-tasks" as ConfigKey,
  type: typeNavigationKey,
  path: "tasks",
  query: { filters: { type: "Task", project: "{uid}" } },
  parent: mockNav1Key,
} as const satisfies Fieldset;

export const mockNav3Entity = {
  id: newConfigAppId(2),
  uid: "_navRoot002" as ConfigUid,
  key: "nav-all-tasks" as ConfigKey,
  type: typeNavigationKey,
  path: "all-tasks",
  query: { filters: { type: "Task" } },
} as const satisfies Fieldset;

export const mockNav4Entity = {
  id: newConfigAppId(3),
  uid: "_navRoot003" as ConfigUid,
  key: "nav-tasks" as ConfigKey,
  type: typeNavigationKey,
  path: "tasks/{key}",
  where: { type: "Task" },
  includes: { title: true, status: true, project: true },
} as const satisfies Fieldset;

export const mockNav6Entity = {
  id: newConfigAppId(6),
  uid: "_navRoot005" as ConfigUid,
  key: "nav-limited-tasks" as ConfigKey,
  type: typeNavigationKey,
  path: "limited-tasks/{key}",
  where: { type: "Task" },
  limit: 10,
} as const satisfies Fieldset;

export const mockMdTaskViewEntity = {
  id: newConfigAppId(4),
  uid: "_tmplMdTask" as ConfigUid,
  key: "md-task-view" as ConfigKey,
  type: typeViewKey,
  viewContent: `# {title}\n\n## Description\n\n{description}\n`,
  preamble: ["status", "project"],
} as const satisfies Fieldset;

export const mockNav5Entity = {
  id: newConfigAppId(5),
  uid: "_navRoot004" as ConfigUid,
  key: "nav-md-tasks" as ConfigKey,
  type: typeNavigationKey,
  path: "md-tasks/{key}",
  where: { type: "Task" },
  view: "md-task-view" as ConfigKey,
} as const satisfies Fieldset;

export const mockNavigationConfigInput = [
  changesetInputForNewEntity<"config">(mockNav1Entity),
  changesetInputForNewEntity<"config">(mockNav2Entity),
  changesetInputForNewEntity<"config">(mockNav3Entity),
  changesetInputForNewEntity<"config">(mockNav4Entity),
  changesetInputForNewEntity<"config">(mockMdTaskViewEntity),
  changesetInputForNewEntity<"config">(mockNav5Entity),
  changesetInputForNewEntity<"config">(mockNav6Entity),
];

// -- Status-based navigation for testing entity moves between locations --

export const mockTaskStatusViewKey = "task-status-view" as ConfigKey;

export const mockTaskStatusViewEntity = {
  id: newConfigAppId(30),
  uid: "_viewStatVw" as ConfigUid,
  key: mockTaskStatusViewKey,
  type: typeViewKey,
  viewContent: "# {title}\n\n{description}\n",
  preamble: ["status", "priority"],
} as const satisfies Fieldset;

export const mockNavPendingTasksEntity = {
  id: newConfigAppId(31),
  uid: "_navPndTsk0" as ConfigUid,
  key: "nav-pending-tasks" as ConfigKey,
  type: typeNavigationKey,
  path: "tasks/{priority} {key}",
  where: { type: "Task", status: ["pending", "active"] },
  view: mockTaskStatusViewKey,
} as const satisfies Fieldset;

export const mockNavArchivedTasksEntity = {
  id: newConfigAppId(32),
  uid: "_navArcTsk0" as ConfigUid,
  key: "nav-archived-tasks" as ConfigKey,
  type: typeNavigationKey,
  path: "tasks/backlog/{priority} {key}",
  where: { type: "Task", status: "archived" },
  view: mockTaskStatusViewKey,
} as const satisfies Fieldset;

export const mockNavCompletedTasksEntity = {
  id: newConfigAppId(33),
  uid: "_navCmpTsk0" as ConfigUid,
  key: "nav-completed-tasks" as ConfigKey,
  type: typeNavigationKey,
  path: "archive/tasks/{key}",
  where: { type: "Task", status: "complete" },
  view: mockTaskStatusViewKey,
} as const satisfies Fieldset;

export const mockNavProjectsByKeyEntity = {
  id: newConfigAppId(34),
  uid: "_navPrjKey0" as ConfigUid,
  key: "nav-projects-by-key" as ConfigKey,
  type: typeNavigationKey,
  path: "projects/{key}",
  where: { type: "Project" },
} as const satisfies Fieldset;

export const mockStatusNavConfigInput = [
  changesetInputForNewEntity<"config">(mockNavPendingTasksEntity),
  changesetInputForNewEntity<"config">(mockNavArchivedTasksEntity),
  changesetInputForNewEntity<"config">(mockNavCompletedTasksEntity),
];
