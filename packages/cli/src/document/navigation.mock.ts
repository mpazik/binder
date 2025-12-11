import {
  changesetInputForNewEntity,
  type ConfigKey,
  type ConfigUid,
  type Fieldset,
  newUserConfigId,
} from "@binder/db";
import { typeNavigationKey } from "../cli-config-schema.ts";

export const mockNav1Uid = "navRoot0001" as ConfigUid;
export const mockNav2Uid = "navChild001" as ConfigUid;
export const mockNav3Uid = "navRoot0002" as ConfigUid;

export const mockNav1Entity = {
  id: newUserConfigId(0),
  uid: mockNav1Uid,
  key: "nav-projects" as ConfigKey,
  type: typeNavigationKey,
  path: "projects/{title}/",
  where: { type: "Project" },
  children: [mockNav2Uid],
} as const satisfies Fieldset;

export const mockNav2Entity = {
  id: newUserConfigId(1),
  uid: mockNav2Uid,
  key: "nav-project-tasks" as ConfigKey,
  type: typeNavigationKey,
  path: "tasks",
  query: { filters: { type: "Task", project: "{uid}" } },
  parent: mockNav1Uid,
} as const satisfies Fieldset;

export const mockNav3Entity = {
  id: newUserConfigId(2),
  uid: mockNav3Uid,
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
