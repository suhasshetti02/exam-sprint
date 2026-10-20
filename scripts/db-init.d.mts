import type { DatabaseSync } from "node:sqlite";

export function applyMigrations(db: DatabaseSync, migrationsDir?: string): string[];
export function seedConcepts(db: DatabaseSync, seedDir?: string): number;
export function seedNotes(db: DatabaseSync, notesDir?: string): number;
export function seedQuestions(db: DatabaseSync, seedDir?: string): number;
