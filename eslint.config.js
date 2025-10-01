import js from "@eslint/js";
import importPlugin from "eslint-plugin-import";
import { includeIgnoreFile } from "@eslint/compat";
import globals from "globals";
import { fileURLToPath } from "node:url";
import ts from "typescript-eslint";

const gitignorePath = fileURLToPath(new URL("./.gitignore", import.meta.url));

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
    },
    plugins: {
      import: importPlugin,
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
      "import/order": "error",
      "import/no-duplicates": "error",
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
      ],
    },
    settings: {
      "import/resolver": {
        node: {},
      },
    },
  },
  {
    files: [".opencode/**/*.ts"],
    rules: {
      "no-restricted-syntax": "off",
      "no-console": "off",
    },
  },
  {
    ignores: [
      "**/build/",
      "**/dist/",
      "eslint.config.js",
      "**/.astro/",
      "**/.sst",
      "**/.wrangler",
    ],
  },
);
