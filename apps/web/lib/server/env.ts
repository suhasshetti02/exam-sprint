import { existsSync } from "node:fs";
import { resolve } from "node:path";

let envLoaded = false;

/**
 * Server-only helper to load local environment configuration files into process.env.
 * Checks for .env.local and .env in apps/web and the workspace root.
 * Preserves already-set environment variables.
 * Never logs or exposes credentials.
 */
export function ensureServerEnvLoaded(): void {
  if (envLoaded) return;
  envLoaded = true;

  if (typeof process.loadEnvFile !== "function") return;

  const candidatePaths = [
    resolve(process.cwd(), ".env.local"),
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "apps", "web", ".env.local"),
    resolve(process.cwd(), "apps", "web", ".env"),
    resolve(process.cwd(), "..", ".env.local"),
    resolve(process.cwd(), "..", ".env"),
  ];

  const attempted = new Set<string>();
  for (const p of candidatePaths) {
    if (attempted.has(p)) continue;
    attempted.add(p);
    try {
      if (existsSync(/*turbopackIgnore: true*/ p)) {
        process.loadEnvFile(p);
      }
    } catch {
      // Ignore syntax or read errors in env files; defaults or process.env will apply
    }
  }
}
