/**
 * Opens the SQLite database and returns all stored chunks as SourceChunk[].
 * Server-only: uses node:sqlite. Never import this from packages/core.
 */

import { DatabaseSync } from "node:sqlite";
import type { SourceChunk } from "@exam-sprint/core";

interface ChunkRow {
  id: string;
  document_id: string;
  heading: string;
  ordinal: number;
  text: string;
}

/** Load every chunk from the `chunks` table in document/ordinal order. */
export function loadChunks(db: DatabaseSync): SourceChunk[] {
  const rows = db
    .prepare(
      "SELECT id, document_id, heading, ordinal, text FROM chunks ORDER BY document_id, ordinal",
    )
    .all() as unknown as ChunkRow[];

  return rows.map((r) => ({
    id: r.id,
    documentId: r.document_id,
    heading: r.heading,
    ordinal: r.ordinal,
    text: r.text,
  }));
}
