/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    project: true,
    tsconfigRootDir: __dirname,
  },
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking",
    "prettier",
  ],
  rules: {
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
    // Fastify plugins must be async even without await (required by FastifyPluginAsync type)
    "@typescript-eslint/require-await": "off",
  },
  ignorePatterns: [
    "node_modules/",
    "dist/",
    "build/",
    "*.js",
    "*.cjs",
    "*.mjs",
    "**/prisma.config.ts",
    "**/vitest.config.ts",
  ],
};
