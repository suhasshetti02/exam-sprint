-- Exam Sprint schema, migration 002: Rapid-Fire Redemption.
-- Applied by scripts/db-init.mjs (SQLite). Timestamps are ISO-8601 UTC text.

-- A single 5-question timed challenge session.
CREATE TABLE challenge_runs (
  id            TEXT PRIMARY KEY,             -- 'chal_<uuid>'
  student_id    TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'completed', 'abandoned')),
  score         INTEGER NOT NULL DEFAULT 0,  -- number of correct answers (0-5, server-calculated)
  total_slots   INTEGER NOT NULL DEFAULT 5,
  started_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at  TEXT                          -- NULL while in progress
);
CREATE INDEX idx_challenge_runs_student ON challenge_runs (student_id, started_at DESC);

-- One row per question slot in a challenge run. Prevents duplicate submissions.
CREATE TABLE challenge_question_slots (
  id              TEXT PRIMARY KEY,           -- 'slot_<uuid>'
  challenge_id    TEXT NOT NULL REFERENCES challenge_runs(id) ON DELETE CASCADE,
  slot_index      INTEGER NOT NULL,           -- 0-based position within the run (0-4)
  question_id     TEXT NOT NULL REFERENCES questions(id),
  concept_id      TEXT NOT NULL,
  answer_text     TEXT,                       -- NULL until answered
  verdict         TEXT CHECK (verdict IN ('correct', 'partially_correct', 'incorrect')),
  explanation     TEXT,
  answered_at     TEXT,                       -- NULL until answered
  attempt_id      TEXT REFERENCES attempts(id), -- linked regular attempt for mastery updates
  UNIQUE (challenge_id, slot_index),
  UNIQUE (challenge_id, question_id)          -- no duplicate questions per run
);
CREATE INDEX idx_slots_challenge ON challenge_question_slots (challenge_id, slot_index);
