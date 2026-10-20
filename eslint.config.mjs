import js from "@eslint/js";
import nextVitals from "eslint-config-next/core-web-vitals";
import tseslint from "typescript-eslint";

// `verbatimModuleSyntax` in tsconfig already forces `import type` where needed.
const webFiles = ["apps/web/**/*.{ts,tsx}"];

export default [
  { ignores: ["**/node_modules/**", "**/.next/**", "**/dist/**", "**/coverage/**", "**/next-env.d.ts", "data/local/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Next.js rules apply to the web app only.
  ...nextVitals.map((c) =>
    Object.keys(c).every((k) => k === "ignores") ? c : { ...c, files: webFiles, settings: { ...c.settings, next: { rootDir: "apps/web" } } },
  ),
  {
    files: ["**/*.{ts,tsx,mjs}"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  { files: ["scripts/**/*.mjs", "*.config.mjs", "apps/web/postcss.config.mjs"], languageOptions: { globals: { process: "readonly", console: "readonly", fetch: "readonly", AbortSignal: "readonly" } } },
];
