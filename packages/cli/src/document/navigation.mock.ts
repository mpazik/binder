import {
  changesetInputForNewEntity,
  type ConfigKey,
  type ConfigUid,
  type Fieldset,
  newUserConfigId,
} from "@binder/db";
import { typeNavigationKey } from "../cli-config-schema.ts";

export const mockNav1Key = "nav-projects" as ConfigKey;

export const mockNav1Entity = {
  id: newUserConfigId(0),
  uid: "navRoot0001" as ConfigUid,
  key: mockNav1Key,
  type: typeNavigationKey,
  path: "projects/{title}/",
  where: { type: "Project" },
} as const satisfies Fieldset;

export const mockNav2Entity = {
  id: newUserConfigId(1),
  uid: "navChild001" as ConfigUid,
  key: "nav-project-tasks" as ConfigKey,
  type: typeNavigationKey,
  path: "tasks",
  query: { filters: { type: "Task", project: "{uid}" } },
  parent: mockNav1Key,
} as const satisfies Fieldset;

export const mockNav3Entity = {
  id: newUserConfigId(2),
  uid: "navRoot0002" as ConfigUid,
  key: "nav-all-tasks" as ConfigKey,
  type: typeNavigationKey,
  path: "all-tasks",
  query: { filters: { type: "Task" } },
} as const satisfies Fieldset;

export const mockNavigationConfigInput = [
  changesetInputForNewEntity<"config">(mockNav1Entity),
  changesetInputForNewEntity<"config">(mockNav2Entity),
  changesetInputForNewEntity<"config">(mockNav3Entity),
];
