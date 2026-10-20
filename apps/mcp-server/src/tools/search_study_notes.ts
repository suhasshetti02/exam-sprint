import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { Bm25Retriever, searchStudyNotesInput, searchStudyNotesOutput } from "@exam-sprint/core";
import type { ToolDefinition } from "./types";
import { loadConfig } from "../config";
import { loadChunks } from "../db/chunks";

/**
 * Resolves the absolute path to the monorepo root at call-time.
 * This file lives at: apps/mcp-server/src/tools/search_study_notes.ts
 * Four `..` traversals reach the monorepo root.
 */
function resolveMonorepoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
}

/**
 * Builds a fresh BM25 retriever from the database for each tool call.
 * The database is small (tens of chunks) so the in-memory index is built
 * cheaply on every request. This matches the stateless server model.
 *
 * Returns an empty retriever (zero results) when the database file has not
 * been created yet (i.e. `npm run db:init` has not been run), or if the DB
 * cannot be opened for any reason.
 */
function buildRetriever(): Bm25Retriever {
  try {
    const config = loadConfig();
    const dbPath = resolve(resolveMonorepoRoot(), config.DATABASE_PATH);
    if (!existsSync(dbPath)) {
      return new Bm25Retriever([]);
    }
    const db = new DatabaseSync(dbPath);
    try {
      const chunks = loadChunks(db);
      return new Bm25Retriever(chunks);
    } finally {
      db.close();
    }
  } catch {
    // Configuration or DB error: return empty retriever so the tool
    // returns [] rather than propagating an internal error.
    return new Bm25Retriever([]);
  }
}

export const searchStudyNotesTool: ToolDefinition<typeof searchStudyNotesInput> = {
  name: "search_study_notes",
  status: "implemented",
  config: {
    title: "search_study_notes",
    description:
      "Keyword (BM25) search over the student's study notes. Returns chunks with stable chunk IDs, source headings, and relevance scores.",
    inputSchema: searchStudyNotesInput,
    outputSchema: searchStudyNotesOutput,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  handler: async (input) => {
    const retriever = buildRetriever();
    const hits = await retriever.search(input.query, input.limit, input.documentId);
    const results = hits.map((h) => ({
      chunkId: h.chunk.id,
      documentId: h.chunk.documentId,
      heading: h.chunk.heading,
      text: h.chunk.text,
      score: h.score,
    }));
    const output = { results };
    return {
      // `structuredContent` is required by MCP SDK ≥ 1.11 when `outputSchema` is set.
      structuredContent: output,
      content: [{ type: "text" as const, text: JSON.stringify(output) }],
    };
  },
};

