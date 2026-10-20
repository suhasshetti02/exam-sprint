#!/usr/bin/env node
/**
 * Creates the local SQLite database, applies data/migrations/*.sql in order,
 * seeds concepts, and ingests sample notes as retrievable chunks.
 * Uses Node's built-in `node:sqlite` (Node >= 22.12).
 * It prints an ExperimentalWarning on Node 22; that is expected.
 *
 * Usage: npm run db:init            (uses DATABASE_PATH or data/local/exam-sprint.db)
 *
 * Idempotency: re-running is safe.
 *   - Migrations use schema_migrations to skip already-applied files.
 *   - Documents and concepts use INSERT OR IGNORE.
 *   - Chunks are inserted with INSERT OR IGNORE on the primary key; if the content
 *     hash has changed the row is replaced (UPDATE ... WHERE content_hash != ?).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function applyMigrations(db, migrationsDir = join(root, "data", "migrations")) {
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const applied = new Set(db.prepare("SELECT name FROM schema_migrations").all().map((r) => r.name));
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  const newlyApplied = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    db.exec("BEGIN");
    try {
      db.exec(readFileSync(join(migrationsDir, file), "utf8"));
      db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(file, new Date().toISOString());
      db.exec("COMMIT");
      newlyApplied.push(file);
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return newlyApplied;
}

/** Seeds only the concept catalogue and its documents' stubs, never student data. */
export function seedConcepts(db, seedDir = join(root, "data", "seed")) {
  const concepts = JSON.parse(readFileSync(join(seedDir, "concepts.json"), "utf8"));
  const insertDoc = db.prepare("INSERT OR IGNORE INTO documents (id, title, origin) VALUES (?, ?, 'sample')");
  const insertConcept = db.prepare("INSERT OR IGNORE INTO concepts (id, title, document_id) VALUES (?, ?, ?)");
  for (const c of concepts) {
    insertDoc.run(c.documentId, c.documentId);
    insertConcept.run(c.id, c.title, c.documentId);
  }
  return concepts.length;
}

/**
 * Parses a Markdown frontmatter block and returns its key/value pairs.
 * Only handles simple `key: value` lines; does not support nested YAML.
 */
function parseFrontmatter(md) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
  if (!match) return {};
  const meta = {};
  for (const line of match[1].split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    meta[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return meta;
}

/**
 * Splits a Markdown string on `#`-level headings (same algorithm as core/chunker.ts).
 * Returns [{id, documentId, heading, ordinal, text, contentHash}].
 * Must stay in sync with packages/core/src/chunker.ts.
 */
function chunkMarkdown(documentId, markdown) {
  if (!documentId || !documentId.trim()) {
    throw new Error("chunkMarkdown: documentId must be non-empty");
  }
  // Strip frontmatter
  const body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  // Split on # headings
  const segments = body.split(/^(#{1,6} .+)$/m);
  const chunks = [];
  const slugCount = new Map();
  let ordinal = 0;

  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i] ?? "";
    if (!/^#{1,6} /.test(segment)) continue;

    const headingText = segment.replace(/^#+\s+/, "").trim();
    const rawText = segments[i + 1] ?? "";
    const text = rawText.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
    if (!text) continue;

    // Slug
    const baseSlug = headingText
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    const count = slugCount.get(baseSlug) ?? 0;
    slugCount.set(baseSlug, count + 1);
    const slug = count === 0 ? baseSlug : `${baseSlug}-${count + 1}`;

    const contentHash = createHash("sha256").update(text, "utf8").digest("hex");
    chunks.push({
      id: `${documentId}#${slug}`,
      documentId,
      heading: headingText,
      ordinal: ordinal++,
      text,
      contentHash,
    });
  }
  return chunks;
}

/**
 * Reads every *.md file in data/sample-notes, extracts document metadata from
 * the YAML front-matter, chunks the content, and upserts into the database.
 *
 * Idempotency: rows are inserted with INSERT OR IGNORE; if the content_hash of
 * an existing row has changed the text is updated via a follow-up UPDATE.
 * Running this function twice on unchanged notes produces no database writes on
 * the second run.
 *
 * Returns the total number of chunks processed.
 */
export function seedNotes(db, notesDir = join(root, "data", "sample-notes")) {
  db.exec("PRAGMA foreign_keys = ON;");

  const upsertDoc = db.prepare(
    "INSERT OR IGNORE INTO documents (id, title, origin) VALUES (?, ?, ?)",
  );
  const insertChunk = db.prepare(
    `INSERT OR IGNORE INTO chunks (id, document_id, heading, ordinal, text, content_hash)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const updateChunkIfChanged = db.prepare(
    `UPDATE chunks SET heading = ?, text = ?, content_hash = ?
     WHERE id = ? AND content_hash != ?`,
  );

  const files = readdirSync(notesDir).filter((f) => f.endsWith(".md")).sort();
  let total = 0;

  for (const file of files) {
    const md = readFileSync(join(notesDir, file), "utf8");
    const meta = parseFrontmatter(md);
    const documentId = meta["id"];
    if (!documentId) {
      console.warn(`  Skipping ${file}: no 'id:' in front-matter`);
      continue;
    }
    const title = meta["title"] ?? documentId;
    const origin = meta["origin"] ?? "sample";

    upsertDoc.run(documentId, title, origin);

    const chunks = chunkMarkdown(documentId, md);
    for (const chunk of chunks) {
      insertChunk.run(
        chunk.id,
        chunk.documentId,
        chunk.heading,
        chunk.ordinal,
        chunk.text,
        chunk.contentHash,
      );
      // Update if content changed (hash changed means text was edited)
      updateChunkIfChanged.run(
        chunk.heading,
        chunk.text,
        chunk.contentHash,
        chunk.id,
        chunk.contentHash,
      );
      total++;
    }
  }

  return total;
}

/**
 * Normalises text for whitespace-collapse comparison (same as evidence-verifier.ts).
 */
function normaliseQuote(text) {
  return text.replace(/[\s\r\n\t]+/g, " ").trim();
}

/**
 * Finds character offsets of quote inside chunkText.
 */
function findOffsets(chunkText, quote) {
  const normHaystack = normaliseQuote(chunkText).toLowerCase();
  const normNeedle = normaliseQuote(quote).toLowerCase();
  if (!normNeedle) return null;
  const idx = normHaystack.indexOf(normNeedle);
  if (idx === -1) return null;

  let normPos = 0;
  let origStart = -1;
  let origEnd = -1;
  let inWhitespace = false;

  for (let origPos = 0; origPos < chunkText.length; origPos++) {
    const ch = chunkText[origPos];
    const isWs = /\s/.test(ch);
    if (isWs) {
      if (!inWhitespace) {
        if (normPos === idx && origStart === -1) origStart = origPos;
        normPos++;
        if (normPos === idx + normNeedle.length) { origEnd = origPos; break; }
        inWhitespace = true;
      }
    } else {
      inWhitespace = false;
      if (normPos === idx && origStart === -1) origStart = origPos;
      normPos++;
      if (normPos === idx + normNeedle.length) { origEnd = origPos + 1; break; }
    }
  }

  if (origStart === -1 || origEnd === -1) {
    const rawIdx = chunkText.toLowerCase().indexOf(normaliseQuote(quote).toLowerCase());
    if (rawIdx === -1) return null;
    return { start: rawIdx, end: rawIdx + quote.length };
  }
  return { start: origStart, end: origEnd };
}

/**
 * Seeds the question bank from data/seed/questions.json into the SQLite database.
 * Every question must pass evidence verification against its referenced chunk.
 * If evidence verification fails, the question is rejected.
 * Idempotent: re-running is safe.
 */
export function seedQuestions(db, seedDir = join(root, "data", "seed")) {
  const questionsPath = join(seedDir, "questions.json");
  if (!existsSync(questionsPath)) return 0;

  const questions = JSON.parse(readFileSync(questionsPath, "utf8"));
  const getChunk = db.prepare("SELECT text FROM chunks WHERE id = ?");
  const upsertQuestion = db.prepare(`
    INSERT INTO questions (
      id, concept_id, kind, prompt, choices_json, expected_json,
      evidence_chunk_id, evidence_quote, evidence_start, evidence_end, verified_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      concept_id = excluded.concept_id,
      kind = excluded.kind,
      prompt = excluded.prompt,
      choices_json = excluded.choices_json,
      expected_json = excluded.expected_json,
      evidence_chunk_id = excluded.evidence_chunk_id,
      evidence_quote = excluded.evidence_quote,
      evidence_start = excluded.evidence_start,
      evidence_end = excluded.evidence_end,
      verified_at = excluded.verified_at
  `);

  let seededCount = 0;
  for (const q of questions) {
    const chunkRow = getChunk.get(q.evidenceChunkId);
    if (!chunkRow || !chunkRow.text) {
      throw new Error(`seedQuestions: chunk ${q.evidenceChunkId} not found in database for question ${q.id}`);
    }
    const offsets = findOffsets(chunkRow.text, q.evidenceQuote);
    if (!offsets) {
      throw new Error(`seedQuestions: evidence quote for question ${q.id} not verified against chunk ${q.evidenceChunkId}`);
    }

    const choicesJson = q.choices ? JSON.stringify(q.choices) : null;
    const expectedJson = JSON.stringify(q.expected);
    const verifiedAt = new Date().toISOString();

    upsertQuestion.run(
      q.id,
      q.conceptId,
      q.kind,
      q.prompt,
      choicesJson,
      expectedJson,
      q.evidenceChunkId,
      q.evidenceQuote,
      offsets.start,
      offsets.end,
      verifiedAt,
    );
    seededCount++;
  }
  return seededCount;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dbPath = resolve(root, process.env.DATABASE_PATH ?? "data/local/exam-sprint.db");
  if (!existsSync(dirname(dbPath))) mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  const applied = applyMigrations(db);
  const seeded = seedConcepts(db);
  const chunks = seedNotes(db);
  const questions = seedQuestions(db);
  db.prepare("INSERT OR IGNORE INTO students (id) VALUES ('local-student')").run();
  db.close();
  console.log(`Database ready at ${dbPath}`);
  console.log(applied.length ? `Applied: ${applied.join(", ")}` : "No new migrations.");
  console.log(`Concept catalogue: ${seeded} concepts.`);
  console.log(`Note chunks: ${chunks} chunks ingested (re-run is idempotent).`);
  console.log(`Question bank: ${questions} questions verified and seeded.`);
}
