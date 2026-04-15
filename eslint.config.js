import js from "@eslint/js";
import importPlugin from "eslint-plugin-import-x";
import unusedImports from "eslint-plugin-unused-imports";
import { includeIgnoreFile } from "@eslint/compat";
import globals from "globals";
import { fileURLToPath } from "node:url";
import ts from "typescript-eslint";
import { rule as requireCtxForServices } from "./tools/eslint-rules/require-ctx-for-services.js";

const gitignorePath = fileURLToPath(new URL("./.gitignore", import.meta.url));

const staticErrorKeyMessage =
  "Error key must be a static string literal, not a template literal. Interpolate runtime values into the message instead.";

export default ts.config(
  includeIgnoreFile(gitignorePath),
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: fileURLToPath(new URL(".", import.meta.url)),
      },
    },
    plugins: {
      "import-x": importPlugin,
      "unused-imports": unusedImports,
      local: {
        rules: {
          "require-ctx-for-services": requireCtxForServices,
        },
      },
    },
    rules: {
      "no-console": [
        "warn",
        { allow: ["warn", "error", "info", "time", "timeEnd", "debug"] },
      ],
      "no-constant-condition": ["error", { checkLoops: false }],
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/ban-types": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "unused-imports/no-unused-imports": "error",
      "import-x/order": "error",
      "import-x/no-duplicates": "error",
      "local/require-ctx-for-services": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: "TryStatement",
          message:
            "Try-catch blocks are not allowed. Use `Result` or `ResultAsync` utility from @binder/utils.",
        },
        {
          selector: "ThrowStatement",
          message:
            "Throwing exceptions is not allowed. Use `Result` or ResultAsync utility from @binder/utils.",
        },
        {
          selector:
            "CallExpression[callee.name='fail'][arguments.0.type='TemplateLiteral']",
          message: staticErrorKeyMessage,
        },
        {
          selector:
            "CallExpression[callee.name='createError'][arguments.0.type='TemplateLiteral']",
          message: staticErrorKeyMessage,
        },
        {
          selector:
            "CallExpression[callee.name='wrapError'][arguments.2.type='Literal'][arguments.1.type='TemplateLiteral']",
          message: staticErrorKeyMessage,
        },
        {
          selector:
            "CallExpression[callee.name='wrapError'][arguments.3][arguments.1.type='TemplateLiteral']",
          message: staticErrorKeyMessage,
        },
      ],
    },
    settings: {
      "import-x/resolver": {
        node: {},
      },
    },
  },
  {
    files: ["examples/**/*.ts", "workflow/**/*.ts"],
    rules: {
      "no-restricted-syntax": "off",
      "no-console": "off",
    },
  },
  {
    ignores: [
      "**/integration/",
      "**/out/",
      "**/build/",
      "**/dist/",
      "eslint.config.js",
      "**/.astro/",
      "**/.sst",
      "**/.wrangler",
    ],
  },
);
