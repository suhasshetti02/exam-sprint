import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": rootDir,
      "@exam-sprint/core": fileURLToPath(
        new URL("../../packages/core/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    fileParallelism: false,
    globalSetup: ["tests/setup/global-setup.ts"],
  },
});
