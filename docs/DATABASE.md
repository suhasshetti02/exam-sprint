# Database plan (SQLite)

Schema: `data/migrations/001_init.sql`. Runner: `scripts/db-init.mjs` (`npm run db:init`), which applies
pending `*.sql` files in name order inside a transaction and records them in `schema_migrations`.
The database file defaults to `data/local/exam-sprint.db` and is git-ignored.

| Table | Purpose |
|---|---|
| `documents`, `chunks` | Study notes split by heading; chunk id `<document>#<slug>`; `content_hash` detects edits |
| `concepts` | Catalogue seeded from `data/seed/concepts.json` |
| `students` | Opaque server-issued ids only; no personal data |
| `questions` | Generated questions with the **verified** evidence quote and offsets; answer key stays server-side |
| `attempts` | One row per answer with verdict and the verified quotation shown |
| `concept_mastery` | Per student and concept: mastery 0–1, attempt count, next review time |
| `misconceptions` | Labelled, per student and concept; `resolved_at` closes them |
| `retests` | Follow-up checks tied to a misconception, with status and the attempt that completed them |

Rules: foreign keys on; mastery constrained to 0..1; a question cannot exist without a real chunk.
Not yet loaded: note chunks (needs the chunker). Reset locally by deleting `data/local/`.
