/**
 * ESLint rule: require-ctx-for-services
 *
 * If an exported function has 2+ parameters typed as known service types,
 * they must be bundled into a single `ctx` parameter (first position)
 * with a type name ending in Ctx or Context.
 *
 * One service parameter is allowed without ctx.
 */

const DEFAULT_SERVICE_TYPES = [
  "KnowledgeGraph",
  "DatabaseCli",
  "FileSystem",
  "Logger",
  "Ui",
  "AppConfig",
  "NavigationLoader",
  "ViewLoader",
];

const CTX_TYPE_PATTERN = /(Ctx|Context)$/;

/**
 * @param {import("typescript").Type} type
 * @param {Set<string>} serviceTypes
 * @returns {boolean}
 */
const isServiceType = (type, serviceTypes) => {
  if (type.isUnion?.() || type.isIntersection?.()) {
    return type.types.some((t) => isServiceType(t, serviceTypes));
  }
  // Check aliasSymbol first (preserves type alias names like FileSystem, KnowledgeGraph)
  // getSymbol() on structural types returns __type which is useless
  const symbol = type.aliasSymbol ?? type.getSymbol?.();
  if (!symbol) return false;
  return serviceTypes.has(symbol.getName());
};

/**
 * @param {import("typescript").Type} type
 * @returns {boolean}
 */
const isCtxType = (type) => {
  // Check aliasSymbol first (for type aliases like VerifySyncCtx)
  const symbol = type.aliasSymbol ?? type.getSymbol?.();
  if (!symbol) return false;
  return CTX_TYPE_PATTERN.test(symbol.getName());
};

/**
 * @param {import("@typescript-eslint/utils").TSESTree.Node} node
 * @returns {boolean}
 */
const isExported = (node) => {
  const parent = node.parent;
  if (!parent) return false;

  if (
    parent.type === "ExportNamedDeclaration" ||
    parent.type === "ExportDefaultDeclaration"
  ) {
    return true;
  }

  if (parent.type === "VariableDeclarator") {
    const varDecl = parent.parent;
    if (varDecl?.type === "VariableDeclaration") {
      return varDecl.parent?.type === "ExportNamedDeclaration";
    }
  }

  return false;
};

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Require bundling 2+ service-typed parameters into a ctx object as the first argument.",
      url: "https://github.com/binder-do/binder/blob/main/docs/contributing/code-style.md#dependency-injection",
    },
    messages: {
      requireCtx:
        "Function has {{count}} service-typed parameters ({{names}}). Bundle them into a single `ctx` parameter with a *Ctx/*Context type.",
      ctxMustBeFirst: "Parameter `ctx` must be the first parameter.",
      ctxTypeSuffix:
        "Parameter `ctx` must have a named type ending in Ctx or Context, not an inline type.",
    },
    schema: [
      {
        type: "object",
        properties: {
          serviceTypes: {
            type: "array",
            items: { type: "string" },
          },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const options = context.options[0] ?? {};
    const serviceTypes = new Set(options.serviceTypes ?? DEFAULT_SERVICE_TYPES);

    // Access typescript-eslint parser services
    const services = context.sourceCode.parserServices;
    if (!services?.getTypeAtLocation) return {};

    /** @param {import("@typescript-eslint/utils").TSESTree.FunctionDeclaration | import("@typescript-eslint/utils").TSESTree.ArrowFunctionExpression | import("@typescript-eslint/utils").TSESTree.FunctionExpression} node */
    const checkFunction = (node) => {
      if (!isExported(node)) return;

      const params = node.params;
      if (params.length < 2) return;

      // Check ctx position and type suffix
      for (let i = 0; i < params.length; i++) {
        const param = params[i];
        if (param.type !== "Identifier") continue;

        if (param.name === "ctx" && i !== 0) {
          context.report({ node: param, messageId: "ctxMustBeFirst" });
        }

        if (param.name === "ctx" && i === 0) {
          const tsType = services.getTypeAtLocation(param);
          if (!isCtxType(tsType)) {
            context.report({ node: param, messageId: "ctxTypeSuffix" });
          }
        }
      }

      // Count service-typed params (skip first if it's ctx with *Ctx type)
      /** @type {{ index: number; name: string }[]} */
      const serviceParams = [];

      for (let i = 0; i < params.length; i++) {
        const param = params[i];
        if (param.type !== "Identifier") continue;

        // Skip ctx param at position 0 with proper *Ctx type
        if (param.name === "ctx" && i === 0) {
          const tsType = services.getTypeAtLocation(param);
          if (isCtxType(tsType)) continue;
        }

        const tsType = services.getTypeAtLocation(param);
        if (isServiceType(tsType, serviceTypes)) {
          serviceParams.push({ index: i, name: param.name });
        }
      }

      if (serviceParams.length < 2) return;

      context.report({
        node,
        messageId: "requireCtx",
        data: {
          count: String(serviceParams.length),
          names: serviceParams.map((p) => p.name).join(", "),
        },
      });
    };

    return {
      FunctionDeclaration: checkFunction,
      ArrowFunctionExpression: checkFunction,
      FunctionExpression: checkFunction,
    };
  },
};

export { rule };
