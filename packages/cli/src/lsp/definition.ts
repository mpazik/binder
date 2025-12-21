import type { DefinitionParams, Location } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { isScalar } from "yaml";
import { isErr } from "@binder/utils";
import type { Fieldset } from "@binder/db";
import type { Logger } from "../log.ts";
import type { RuntimeContextWithDb } from "../runtime.ts";
import type { ParsedYaml } from "../document/yaml-cst.ts";
import { getPositionContext } from "../document/yaml-cst.ts";
import { findEntityLocation, loadNavigation } from "../document/navigation.ts";
import type { DocumentCache } from "./document-cache.ts";
import { getDocumentContext, lspPositionToYamlPosition } from "./lsp-utils.ts";

const isRelationField = (
  fieldKey: string,
  context: Awaited<ReturnType<typeof getDocumentContext>>,
): boolean => {
  if (!context) return false;
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

type LspDocuments = {
  get: (uri: string) => TextDocument | undefined;
};

export const handleDefinition = async (
  params: DefinitionParams,
  lspDocuments: LspDocuments,
  documentCache: DocumentCache,
  runtime: RuntimeContextWithDb,
  log: Logger,
): Promise<Location | null> => {
  const document = lspDocuments.get(params.textDocument.uri);
  if (!document) {
    log.debug("Document not found for definition", {
      uri: params.textDocument.uri,
    });
    return null;
  }

  const context = await getDocumentContext(document, documentCache, runtime);
  if (!context) {
    log.debug("No document context for definition");
    return null;
  }

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

  const searchResult = await runtime.kg.search({
    filters: {
      key: referenceValue,
    },
  });

  if (isErr(searchResult) || searchResult.data.items.length === 0) {
    const uidSearchResult = await runtime.kg.search({
      filters: {
        uid: referenceValue,
      },
    });

    if (isErr(uidSearchResult) || uidSearchResult.data.items.length === 0) {
      log.debug("Referenced entity not found", { referenceValue });
      return null;
    }

    return buildLocation(
      uidSearchResult.data.items[0] as Fieldset,
      runtime,
      log,
    );
  }

  return buildLocation(searchResult.data.items[0] as Fieldset, runtime, log);
};

const buildLocation = async (
  entity: Fieldset,
  runtime: RuntimeContextWithDb,
  log: Logger,
): Promise<Location | null> => {
  const navigationResult = await loadNavigation(runtime.kg);
  if (isErr(navigationResult)) {
    log.debug("Failed to load navigation", { error: navigationResult.error });
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
