import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      ecmaVersion: 2022,
      sourceType: "module",
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/naming-convention": [
        "warn",
        {
          selector: "import",
          format: ["camelCase", "PascalCase"],
        },
      ],
      curly: "warn",
      eqeqeq: "warn",
      semi: "warn",
      // D42/D48: the `yaml` devDependency is build-time only (the Claude Code
      // plugin emitter's frontmatter parser). It must never reach the
      // runtime bundle (dist/extension.js), so only frontmatter.ts — the one
      // module whose whole job is YAML parsing — may import it. Every other
      // module under src/claudePlugin/ (including the ones the future
      // runtime override-mirroring feature reuses, e.g. mapAgent.ts's
      // slugifyAgentId) must stay yaml-free.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "yaml",
              message: "\"yaml\" is a build-time-only devDependency. Only src/claudePlugin/frontmatter.ts may import it (D42/D48).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/claudePlugin/frontmatter.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
];
