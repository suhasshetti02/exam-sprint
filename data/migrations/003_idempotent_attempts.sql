-- Exam Sprint schema, migration 003: Idempotent answer submissions.
-- Applied by scripts/db-init.mjs (SQLite). Timestamps are ISO-8601 UTC text.

-- Add client_attempt_id to attempts table to enforce client-provided attempt idempotency.
ALTER TABLE attempts ADD COLUMN client_attempt_id TEXT;

-- Enforce uniqueness of student_id and client_attempt_id when client_attempt_id is provided.
-- Partial index preserves full compatibility with legacy or seed rows where client_attempt_id IS NULL.
CREATE UNIQUE INDEX IF NOT EXISTS idx_attempts_student_client_attempt
  ON attempts (student_id, client_attempt_id)
  WHERE client_attempt_id IS NOT NULL;
