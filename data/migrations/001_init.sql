-- Exam Sprint schema, migration 001. Applied by scripts/db-init.mjs (SQLite).
-- Timestamps are ISO-8601 UTC text. Mastery values are 0..1.

CREATE TABLE documents (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  origin     TEXT NOT NULL,                    -- 'sample' | 'student-upload'
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE chunks (
  id           TEXT PRIMARY KEY,               -- '<document_id>#<section-slug>'
  document_id  TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  heading      TEXT NOT NULL,
  ordinal      INTEGER NOT NULL,
  text         TEXT NOT NULL,
  content_hash TEXT NOT NULL,                  -- detects changed notes
  UNIQUE (document_id, ordinal)
);

CREATE TABLE concepts (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE students (
  id         TEXT PRIMARY KEY,                 -- opaque, server-issued; no personal data
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE questions (
  id               TEXT PRIMARY KEY,
  concept_id       TEXT NOT NULL REFERENCES concepts(id),
  kind             TEXT NOT NULL CHECK (kind IN ('multiple_choice', 'short_answer')),
  prompt           TEXT NOT NULL,
  choices_json     TEXT,                       -- JSON array for multiple_choice
  expected_json    TEXT NOT NULL,              -- answer key / rubric (never sent to the client)
  evidence_chunk_id TEXT NOT NULL REFERENCES chunks(id),
  evidence_quote   TEXT NOT NULL,
  evidence_start   INTEGER NOT NULL,           -- offsets of the quote inside the chunk
  evidence_end     INTEGER NOT NULL,
  verified_at      TEXT NOT NULL,              -- a question without verified evidence is never stored
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE attempts (
  id                TEXT PRIMARY KEY,
  student_id        TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  question_id       TEXT NOT NULL REFERENCES questions(id),
  answer_text       TEXT NOT NULL,
  verdict           TEXT NOT NULL CHECK (verdict IN ('correct', 'partially_correct', 'incorrect')),
  evidence_chunk_id TEXT NOT NULL REFERENCES chunks(id),
  evidence_quote    TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_attempts_student ON attempts (student_id, created_at);

CREATE TABLE concept_mastery (
  student_id      TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  concept_id      TEXT NOT NULL REFERENCES concepts(id),
  mastery         REAL NOT NULL DEFAULT 0 CHECK (mastery >= 0 AND mastery <= 1),
  attempts_count  INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  next_review_at  TEXT,
  PRIMARY KEY (student_id, concept_id)
);

CREATE TABLE misconceptions (
  id                TEXT PRIMARY KEY,
  student_id        TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  concept_id        TEXT NOT NULL REFERENCES concepts(id),
  label             TEXT NOT NULL,             -- e.g. 'confuses-3nf-with-bcnf'
  description       TEXT NOT NULL,
  first_seen_at     TEXT NOT NULL,
  last_seen_at      TEXT NOT NULL,
  resolved_at       TEXT,
  source_attempt_id TEXT REFERENCES attempts(id),
  UNIQUE (student_id, concept_id, label)
);

CREATE TABLE retests (
  id                   TEXT PRIMARY KEY,
  student_id           TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  misconception_id     TEXT NOT NULL REFERENCES misconceptions(id) ON DELETE CASCADE,
  due_at               TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'skipped')),
  completed_attempt_id TEXT REFERENCES attempts(id)
);
CREATE INDEX idx_retests_due ON retests (student_id, status, due_at);
