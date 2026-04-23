export {
  BINDER_DIR,
  CONFIG_FILE,
  DATA_DIR,
  DB_FILE,
  getDefaultAuthor,
} from "./constants.ts";

export {
  getGlobalConfigPath,
  getGlobalStatePath,
  resolveWorkspacePaths,
  type WorkspacePaths,
} from "./paths.ts";

export {
  CoreConfigSchema,
  loadGlobalConfig,
  loadWorkspaceConfig,
  saveGlobalConfig,
  type CoreConfig,
  type GlobalConfig,
  type LoadGlobalConfigOptions,
  type LoadWorkspaceConfigOptions,
  type WorkspaceConfig,
} from "./config.ts";

export {
  init,
  open,
  openReadonly,
  type InitOptions,
  type OpenCallbacksFactory,
  type OpenOptions,
  type OpenReadonlyOptions,
  type ReadonlyRepo,
  type Repo,
} from "./open.ts";

export {
  type Err,
  type ErrorObject,
  type Ok,
  type Result,
  type ResultAsync,
  err,
  isErr,
  isOk,
  ok,
  okVoid,
  throwIfError,
  tryCatch,
  createError,
  fail,
} from "@binder/utils";
