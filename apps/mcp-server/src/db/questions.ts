/**
 * SQLite question repository.
 * Server-only: uses node:sqlite.
 */

import type { DatabaseSync } from "node:sqlite";
import type { QuestionKind, QuestionRecord, QuestionRubric } from "@exam-sprint/core";

interface QuestionRow {
  id: string;
  concept_id: string;
  kind: QuestionKind;
  prompt: string;
  choices_json: string | null;
  expected_json: string;
  evidence_chunk_id: string;
  evidence_quote: string;
  evidence_start: number;
  evidence_end: number;
  verified_at: string;
}

function mapRow(row: QuestionRow): QuestionRecord {
  return {
    id: row.id,
    conceptId: row.concept_id,
    kind: row.kind,
    prompt: row.prompt,
    choices: row.choices_json ? (JSON.parse(row.choices_json) as string[]) : undefined,
    expected: JSON.parse(row.expected_json) as QuestionRubric,
    evidenceChunkId: row.evidence_chunk_id,
    evidenceQuote: row.evidence_quote,
    evidenceStart: row.evidence_start,
    evidenceEnd: row.evidence_end,
    verifiedAt: row.verified_at,
  };
}

export function loadQuestions(db: DatabaseSync, conceptId?: string): QuestionRecord[] {
  let rows: QuestionRow[];
  if (conceptId) {
    rows = db
      .prepare(
        "SELECT id, concept_id, kind, prompt, choices_json, expected_json, evidence_chunk_id, evidence_quote, evidence_start, evidence_end, verified_at FROM questions WHERE concept_id = ? ORDER BY id",
      )
      .all(conceptId) as unknown as QuestionRow[];
  } else {
    rows = db
      .prepare(
        "SELECT id, concept_id, kind, prompt, choices_json, expected_json, evidence_chunk_id, evidence_quote, evidence_start, evidence_end, verified_at FROM questions ORDER BY id",
      )
      .all() as unknown as QuestionRow[];
  }
  return rows.map(mapRow);
}

export function getQuestionById(db: DatabaseSync, questionId: string): QuestionRecord | null {
  const row = db
    .prepare(
      "SELECT id, concept_id, kind, prompt, choices_json, expected_json, evidence_chunk_id, evidence_quote, evidence_start, evidence_end, verified_at FROM questions WHERE id = ?",
    )
    .get(questionId) as unknown as QuestionRow | undefined;

  return row ? mapRow(row) : null;
}
