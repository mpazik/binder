import type { DefinitionParams, Location } from "vscode-languageserver/node";
import { isScalar } from "yaml";
import { isErr } from "@binder/utils";
import type { Fieldset } from "@binder/db";
import type { RuntimeContextWithDb } from "../runtime.ts";
import type { ParsedYaml } from "../document/yaml-cst.ts";
import { getPositionContext } from "../document/yaml-cst.ts";
import { findEntityLocation, loadNavigation } from "../document/navigation.ts";
import {
  type DocumentContext,
  lspPositionToYamlPosition,
  type LspHandler,
} from "./lsp-utils.ts";

const isRelationField = (
  fieldKey: string,
  context: DocumentContext,
): boolean => {
  const fieldDef = context.schema.fields[fieldKey];
  return fieldDef?.dataType === "relation";
};

const extractReferenceValue = (
  yamlContext: ReturnType<typeof getPositionContext>,
): string | undefined => {
  if (!yamlContext) return undefined;

  if (yamlContext.type === "value" && isScalar(yamlContext.node)) {
    return String(yamlContext.node.value);
  }

  if (yamlContext.type === "seq-item" && isScalar(yamlContext.node)) {
    return String(yamlContext.node.value);
  }

  return undefined;
};

export const handleDefinition: LspHandler<
  DefinitionParams,
  Location | null
> = async (params, { document, context, runtime }) => {
  const { log, kg } = runtime;
  const namespace = context.namespace;
  const parsed = context.parsed as ParsedYaml;
  if (!parsed.doc || !parsed.lineCounter) {
    log.debug("Not a YAML document");
    return null;
  }

  const yamlPosition = lspPositionToYamlPosition(params.position);
  const yamlContext = getPositionContext(document.getText(), yamlPosition);

  if (!yamlContext) {
    log.debug("No YAML context at position");
    return null;
  }

  const fieldKey = yamlContext.fieldKey;
  if (!fieldKey) {
    log.debug("No field key in context");
    return null;
  }

  if (!isRelationField(fieldKey, context)) {
    log.debug("Field is not a relation", { fieldKey });
    return null;
  }

  const referenceValue = extractReferenceValue(yamlContext);
  if (!referenceValue) {
    log.debug("Could not extract reference value");
    return null;
  }

  log.debug("Looking up reference", { fieldKey, referenceValue });

  const searchResult = await kg.search({
    filters: {
      key: referenceValue,
    },
  });

  if (isErr(searchResult) || searchResult.data.items.length === 0) {
    const uidSearchResult = await kg.search({
      filters: {
        uid: referenceValue,
      },
    });

    if (isErr(uidSearchResult) || uidSearchResult.data.items.length === 0) {
      log.debug("Referenced entity not found", { referenceValue });
      return null;
    }

    return buildLocation(runtime, uidSearchResult.data.items[0] as Fieldset);
  }

  return buildLocation(runtime, searchResult.data.items[0] as Fieldset);
};

const buildLocation = async (
  runtime: RuntimeContextWithDb,
  entity: Fieldset,
): Promise<Location | null> => {
  const { kg, log } = runtime;
  const navigationResult = await loadNavigation(kg);
  if (isErr(navigationResult)) {
    log.error("Failed to load navigation", { error: navigationResult.error });
    return null;
  }

  const locationResult = await findEntityLocation(
    runtime.fs,
    runtime.config.paths,
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
