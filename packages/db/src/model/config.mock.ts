import { newIsoTimestamp } from "@binder/utils";
import type { ConfigId, ConfigKey, ConfigType, ConfigUid } from "./config.ts";
import type { Fieldset } from "./entity.ts";

const baseMockConfig = {
  version: 1,
  createdAt: newIsoTimestamp("2024-01-01"),
  updatedAt: newIsoTimestamp("2024-01-01"),
} as const;

export const mockTaskTypeUid = "cfg-abc1234" as ConfigUid;
export const mockTaskTypeKey = "Task" as ConfigKey;

export const mockTaskType = {
  ...baseMockConfig,
  id: 1 as ConfigId,
  key: mockTaskTypeKey,
  uid: mockTaskTypeUid,
  type: "Type" as ConfigType,
  title: "Task",
  description: "Defines Task node",
} as const satisfies Fieldset;
