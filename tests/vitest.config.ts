import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Repo-level tests (database migrations, repository hygiene). Run from the repo root.
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], root: fileURLToPath(new URL("..", import.meta.url)) },
});
