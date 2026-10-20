import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { loadConfig } from "../config";

/**
 * Resolves the monorepo root path at runtime from apps/mcp-server/src/db.
 */
export function resolveMonorepoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
}

/**
 * Returns the absolute path to the SQLite database.
 */
export function getDatabasePath(): string {
  const config = loadConfig();
  return resolve(resolveMonorepoRoot(), config.DATABASE_PATH);
}

/**
 * Opens a connection to the SQLite database if the file exists, or returns null.
 */
export function openDatabase(): DatabaseSync | null {
  const dbPath = getDatabasePath();
  if (!existsSync(dbPath)) return null;
  return new DatabaseSync(dbPath);
}

/**
 * Local development student identity.
 * In production, this would be derived from session tokens / authentication context.
 */
export const DEFAULT_STUDENT_ID = "local-student";
