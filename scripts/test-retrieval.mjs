import { DatabaseSync } from "node:sqlite";

const K1 = 1.5;
const B = 0.75;

function tokenise(text) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

class Bm25Retriever {
  constructor(chunks) {
    this.entries = chunks.map((chunk) => {
      const tokens = tokenise(`${chunk.heading} ${chunk.text}`);
      const tf = new Map();
      for (const t of tokens) {
        tf.set(t, (tf.get(t) ?? 0) + 1);
      }
      return { chunk, tf, length: tokens.length };
    });

    this.df = new Map();
    for (const entry of this.entries) {
      for (const term of entry.tf.keys()) {
        this.df.set(term, (this.df.get(term) ?? 0) + 1);
      }
    }

    this.N = this.entries.length;
    this.avgdl =
      this.N === 0
        ? 0
        : this.entries.reduce((s, e) => s + e.length, 0) / this.N;
  }

  async search(query, limit) {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const queryTerms = tokenise(trimmed);
    if (queryTerms.length === 0) return [];

    const scored = this.entries.map((entry) => {
      let score = 0;
      for (const term of queryTerms) {
        const df = this.df.get(term) ?? 0;
        if (df === 0) continue;
        const tf = entry.tf.get(term) ?? 0;
        if (tf === 0) continue;

        const idf = Math.log(1 + (this.N - df + 0.5) / (df + 0.5));
        const norm =
          entry.length === 0
            ? 0
            : (tf * (K1 + 1)) /
              (tf + K1 * (1 - B + B * (entry.length / (this.avgdl || 1))));

        score += idf * norm;
      }
      return { chunk: entry.chunk, score };
    });

    return scored
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

const db = new DatabaseSync("data/local/exam-sprint.db");
const docId = "doc_1792473577544_studyflow-test-notes";
const chunks = db
  .prepare("SELECT id, document_id, heading, text FROM chunks WHERE document_id = ?")
  .all(docId);

console.log("Loaded chunks:", chunks.length);

const retriever = new Bm25Retriever(chunks);

const queries = [
  "2NF",
  "Second Normal Form",
  "partial functional dependency",
  "What is Second Normal Form?",
  "ACID properties",
];

for (const q of queries) {
  const hits = await retriever.search(q, 3);
  console.log("\n=================================");
  console.log("Query:", q);
  console.log("Hits found:", hits.length);
  for (const h of hits) {
    console.log(`  -> Score: ${h.score.toFixed(3)} | Chunk: ${h.chunk.id} (${h.chunk.heading})`);
    console.log(`     Text preview: ${h.chunk.text.slice(0, 100)}...`);
  }
}
