import type { DefinitionParams, Location } from "vscode-languageserver/node";
import { isErr } from "@binder/utils";
import type {
  EntityKey,
  EntityUid,
  Fieldset,
  NamespaceEditable,
} from "@binder/db";
import type { RuntimeContextWithDb } from "../../runtime.ts";
import {
  findEntityLocation,
  loadNavigation,
} from "../../document/navigation.ts";
import { type LspHandler } from "../document-context.ts";
import { getCursorContext, type CursorContext } from "../cursor-context.ts";

export type EntityStringRef = EntityKey | EntityUid;

export const getEntityRef = (
  cursorContext: CursorContext,
): EntityStringRef | undefined => {
  if (
    cursorContext.type !== "field-value" &&
    cursorContext.type !== "frontmatter-field-value"
  )
    return undefined;
  if (cursorContext.fieldDef.dataType !== "relation") return undefined;
  if (!cursorContext.currentValue) return undefined;

  return cursorContext.currentValue as EntityStringRef;
};

export const handleDefinition: LspHandler<
  DefinitionParams,
  Location | null
> = async (params, { context, runtime }) => {
  const { log } = runtime;

  const cursorContext = getCursorContext(context, params.position);
  const entityRef = getEntityRef(cursorContext);

  if (!entityRef) {
    log.debug("No entity reference at cursor position");
    return null;
  }

  log.debug("Looking up reference", { entityRef });

  return findReferenceLocation(entityRef, context.namespace, runtime);
};

const findReferenceLocation = async (
  entityRef: EntityStringRef,
  namespace: NamespaceEditable,
  runtime: RuntimeContextWithDb,
): Promise<Location | null> => {
  const { kg, log } = runtime;

  const searchResult = await kg.search({
    filters: { key: entityRef },
  });

  if (isErr(searchResult) || searchResult.data.items.length === 0) {
    const uidSearchResult = await kg.search({
      filters: { uid: entityRef },
    });

    if (isErr(uidSearchResult) || uidSearchResult.data.items.length === 0) {
      log.debug("Referenced entity not found", { entityRef });
      return null;
    }

    return buildLocation(
      runtime,
      namespace,
      uidSearchResult.data.items[0] as Fieldset,
    );
  }

  return buildLocation(
    runtime,
    namespace,
    searchResult.data.items[0] as Fieldset,
  );
};

const buildLocation = async (
  runtime: RuntimeContextWithDb,
  namespace: NamespaceEditable,
  entity: Fieldset,
): Promise<Location | null> => {
  const { kg, log } = runtime;
  const navigationResult = await loadNavigation(kg);
  if (isErr(navigationResult)) {
    log.error("Failed to load navigation", { error: navigationResult.error });
    return null;
  }

  const schemaResult = await kg.getSchema(namespace);
  if (isErr(schemaResult)) {
    log.error("Failed to load schema", { error: schemaResult.error });
    return null;
  }

  const locationResult = await findEntityLocation(
    runtime.fs,
    runtime.config.paths,
    schemaResult.data,
    entity,
    navigationResult.data,
  );

  if (isErr(locationResult)) {
    log.debug("Failed to find entity location", {
      error: locationResult.error,
    });
    return null;
  }

  if (!locationResult.data) {
    log.debug("No location found for entity");
    return null;
  }

  const { filePath, line } = locationResult.data;

  return {
    uri: `file://${filePath}`,
    range: {
      start: { line, character: 0 },
      end: { line, character: 0 },
    },
  };
};
