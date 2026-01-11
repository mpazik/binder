import type { DefinitionParams, Location } from "vscode-languageserver/node";
import { isErr } from "@binder/utils";
import type { Fieldset, NamespaceEditable } from "@binder/db";
import type { RuntimeContextWithDb } from "../../runtime.ts";
import {
  findEntityLocation,
  loadNavigation,
} from "../../document/navigation.ts";
import { type LspHandler } from "../document-context.ts";
import { getCursorContext } from "../cursor-context.ts";

export const handleDefinition: LspHandler<
  DefinitionParams,
  Location | null
> = async (params, { context, runtime }) => {
  const { log } = runtime;

  const cursorContext = getCursorContext(context, params.position);

  if (cursorContext.type !== "field-value") {
    log.debug("Not on a field value");
    return null;
  }

  if (cursorContext.fieldDef.dataType !== "relation") {
    log.debug("Field is not a relation", {
      fieldPath: cursorContext.fieldPath,
    });
    return null;
  }

  if (!cursorContext.currentValue) {
    log.debug("No current value at cursor position");
    return null;
  }

  const referenceValue = cursorContext.currentValue;
  log.debug("Looking up reference", {
    fieldPath: cursorContext.fieldPath,
    referenceValue,
  });

  return findReferenceLocation(referenceValue, context.namespace, runtime);
};

const findReferenceLocation = async (
  referenceValue: string,
  namespace: NamespaceEditable,
  runtime: RuntimeContextWithDb,
): Promise<Location | null> => {
  const { kg, log } = runtime;

  const searchResult = await kg.search({
    filters: { key: referenceValue },
  });

  if (isErr(searchResult) || searchResult.data.items.length === 0) {
    const uidSearchResult = await kg.search({
      filters: { uid: referenceValue },
    });

    if (isErr(uidSearchResult) || uidSearchResult.data.items.length === 0) {
      log.debug("Referenced entity not found", { referenceValue });
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
