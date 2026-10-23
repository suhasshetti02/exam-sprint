/**
 * Server-side Document Processing and Ingestion Service.
 *
 * Handles:
 * - PDF, TXT, and Markdown (.md) text extraction
 * - Input validation: size limits, empty files, encrypted PDFs, scanned PDFs (no text layer)
 * - Heading/section chunking with stable chunk IDs and content hashes
 * - Storing documents, chunks, concepts, and grounded question stubs in SQLite
 * - Distinguishing student uploads from built-in sample notes
 */

import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  chunkMarkdown,
  DefaultEvidenceVerifier,
  headingToSlug,
  type SourceChunk,
  type QuestionRubric,
} from "@exam-sprint/core";
export { headingToSlug };

// 10MB maximum file size limit
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

export interface DocumentTopicSuggestion {
  id: string;
  label: string;
  topic: string;
  chunkId?: string;
}

export interface DocumentInfo {
  id: string;
  title: string;
  origin: "sample" | "student-upload";
  chunkCount: number;
  conceptCount: number;
  createdAt: string;
  suggestedTopics?: DocumentTopicSuggestion[];
}

export interface IngestionResult {
  fileName: string;
  success: boolean;
  documentId?: string;
  title?: string;
  chunkCount?: number;
  conceptCount?: number;
  error?: string;
}

function findDatabasePath(): string {
  const envPath = process.env.DATABASE_PATH ?? "data/local/exam-sprint.db";
  const candidates = [
    resolve(/*turbopackIgnore: true*/ process.cwd(), envPath),
    resolve(/*turbopackIgnore: true*/ process.cwd(), "..", "..", envPath),
    resolve(/*turbopackIgnore: true*/ process.cwd(), "..", envPath),
    envPath,
  ];
  for (const c of candidates) {
    if (existsSync(/*turbopackIgnore: true*/ c)) return c;
  }
  return candidates[0]!;
}

export function openDb(): DatabaseSync {
  const dbPath = findDatabasePath();
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  return db;
}

/**
 * Extracts raw text from an uploaded file Buffer based on its extension or MIME type.
 */
export async function extractTextFromFile(
  fileName: string,
  buffer: Buffer,
): Promise<{ text: string; format: "markdown" | "text" | "pdf" }> {
  if (!buffer || buffer.length === 0) {
    throw new Error("File is empty.");
  }

  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    throw new Error(`File exceeds maximum size limit of ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB.`);
  }

  const ext = fileName.toLowerCase().slice(fileName.lastIndexOf("."));

  if (ext === ".md") {
    const text = buffer.toString("utf8");
    if (!text.trim()) throw new Error("Markdown file is empty.");
    return { text, format: "markdown" };
  }

  if (ext === ".txt") {
    const text = buffer.toString("utf8");
    if (!text.trim()) throw new Error("Text file is empty.");
    return { text, format: "text" };
  }

  if (ext === ".pdf") {
    try {
      // Ensure pdfjs fake worker is properly initialized for Node.js server environment
      const globalAny = globalThis as unknown as {
        pdfjsWorker?: { WorkerMessageHandler?: unknown };
      };
      if (!globalAny.pdfjsWorker?.WorkerMessageHandler) {
        try {
          await import("pdf-parse/worker");
        } catch {
          try {
            const workerModule = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
            if (workerModule.WorkerMessageHandler) {
              globalAny.pdfjsWorker = {
                WorkerMessageHandler: workerModule.WorkerMessageHandler,
              };
            }
          } catch {
            // Worker will fall back to default resolution
          }
        }
      }

      // Dynamic import to isolate pdf-parse dependency
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: buffer });
      const textResult = await parser.getText();
      const rawText = textResult?.text?.trim() ?? "";

      if (!rawText || rawText.length === 0) {
        throw new Error(
          "This PDF appears to be a scanned image with no extractable text layer. Optical Character Recognition (OCR) is not supported.",
        );
      }

      return { text: rawText, format: "pdf" };
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.message.includes("scanned image")) {
          throw err;
        }
        if (err.name === "PasswordException" || err.message.toLowerCase().includes("password")) {
          throw new Error("PDF is password-protected or encrypted and cannot be parsed.");
        }
        if (
          err.name === "InvalidPDFException" ||
          err.message.toLowerCase().includes("invalid pdf") ||
          err.message.toLowerCase().includes("corrupted") ||
          err.message.toLowerCase().includes("not a valid pdf")
        ) {
          throw new Error("File is corrupted or not a valid PDF.");
        }
        // Sanitize error message to avoid leaking internal filesystem paths
        const sanitizedMsg = err.message
          .replace(/[A-Za-z]:\\[^'"\s\n]+/g, "[internal-path]")
          .replace(/\/[^'"\s\n]+/g, "[internal-path]")
          .replace(/\s+/g, " ")
          .trim();
        throw new Error(`Failed to parse PDF: ${sanitizedMsg}`);
      }
      throw new Error("Failed to parse PDF file.");
    }
  }

  throw new Error(`Unsupported file type '${ext}'. Please upload a PDF (.pdf), Text file (.txt), or Markdown document (.md).`);
}

/**
 * Extracts a meaningful heading from the leading line of a paragraph or text block.
 */
function extractHeadingFromText(text: string, fallbackIndex: number): string {
  const firstLine = text
    .split(/\r?\n/)[0]
    ?.replace(/^[=\-#_~*\s]+/, "")
    ?.replace(/[=\-#_~*\s]+$/, "")
    ?.trim() || "";

  // Pattern 1: Numbered heading, e.g. "1. Normalization Basics" or "2. DevOps Voice Companion"
  const numMatch = firstLine.match(/^[0-9]+[.:\-\s]+([A-Za-z0-9\s&/()\-–—]{3,50})(?:\s+(?:Problem|Background|Overview|Definition|Analysis):|[\r\n.]|$)/i);
  if (numMatch && numMatch[1] && numMatch[1].trim().length >= 3) {
    const number = firstLine.match(/^(\d+(?:\.\d+)*)[.:\-\s]+/)?.[1];
    return `${number ? `${number} ` : ""}${numMatch[1].trim()}`;
  }

  // Pattern 2: Heading with colon, e.g. "Executive Summary:" or "Key Findings:"
  const colonMatch = firstLine.match(/^([A-Za-z0-9\s&/()\-–—]{3,40}):/);
  if (colonMatch && colonMatch[1] && colonMatch[1].trim().length >= 3) {
    return colonMatch[1].trim();
  }

  // Pattern 3: All caps or title case short first line without sentence-ending punctuation
  if (
    firstLine.length >= 4 &&
    firstLine.length <= 50 &&
    !/[.!?]$/.test(firstLine) &&
    !/^(the|a|an|in|on|at|for|to)\b/i.test(firstLine)
  ) {
    return firstLine;
  }

  return `Section ${fallbackIndex}`;
}

/**
 * Splits extracted plain text or PDF text into logical chunks.
 */
export function chunkPlainText(documentId: string, text: string): SourceChunk[] {
  // If text has Markdown-like headings, use chunkMarkdown
  if (/^#{1,6}\s+/m.test(text)) {
    const mdChunks = chunkMarkdown(documentId, text);
    if (mdChunks.length > 0) return mdChunks;
  }

  // Otherwise, split by double newlines or section markers.
  // Pre-normalize single newlines before numbered headings into paragraph breaks
  const normalizedText = text
    .replace(/\r?\n([0-9]+[.:\-\s]+[A-Za-z])/g, "\n\n$1")
    .replace(/\r?\n([A-Z\s]{4,30}:)/g, "\n\n$1");

  const paragraphs = normalizedText
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 30 || /^[0-9]+[.:\-\s]+[A-Za-z]/.test(p) || /^[A-Z0-9\s]{3,40}:?$/.test(p));

  if (paragraphs.length === 0) {
    // If no paragraphs, take the whole text if non-empty
    const single = text.replace(/\s+/g, " ").trim();
    if (single.length === 0) return [];
    return [
      {
        id: `${documentId}#overview`,
        documentId,
        heading: "Overview",
        ordinal: 0,
        text: single,
      },
    ];
  }

  const chunks: SourceChunk[] = [];
  let currentText = "";
  let sectionIndex = 1;

  for (const para of paragraphs) {
    const isNewSection = /^[0-9]+[.:\-\s]+[A-Za-z]/.test(para) || /^[A-Z\s]{3,30}:/.test(para);
    if (
      (isNewSection && currentText.length > 50) ||
      (currentText.length + para.length > 800 && currentText.length > 200)
    ) {
      const heading = extractHeadingFromText(currentText, sectionIndex);
      const slug = headingToSlug(heading) || `section-${sectionIndex}`;
      chunks.push({
        id: `${documentId}#${slug}`,
        documentId,
        heading,
        ordinal: sectionIndex - 1,
        text: currentText.trim(),
      });
      sectionIndex++;
      currentText = para;
    } else {
      currentText = currentText ? `${currentText}\n\n${para}` : para;
    }
  }

  if (currentText.trim().length > 0) {
    const heading = extractHeadingFromText(currentText, sectionIndex);
    const slug = headingToSlug(heading) || `section-${sectionIndex}`;
    chunks.push({
      id: `${documentId}#${slug}`,
      documentId,
      heading,
      ordinal: sectionIndex - 1,
      text: currentText.trim(),
    });
  }

  return chunks;
}

/**
 * Abbreviation-aware, grammatically validated sentence boundary extractor.
 * Prevents sentence fragmenting on 'e.g.', 'i.e.', 'vs.', 'etc.', and decimals.
 * Validates balanced parentheses and brackets to eliminate incomplete sentence slices.
 */
export function extractCleanSentences(text: string): string[] {
  let inBibliography = false;
  const cleaned = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/^[=\-#_~*\s]+[0-9.]*\s*/, "").trim())
    .filter((line) => {
      if (/^(?:references|bibliography|works cited|literature cited)\s*:?[\s.]*$/i.test(line)) {
        inBibliography = true;
        return false;
      }
      if (inBibliography) return false;
      if (!line || /^[=\-#_~*]+$/.test(line) || /^\d{1,4}$/.test(line)) return false;
      if (/[,\uFF0C]\s*(?:and|or)\s+\d+[.)]?$/i.test(line)) return false;
      // Drop common PDF layout debris before neighboring lines are joined.
      if (/^(?:fig(?:ure)?|table)\s*\.?\s*\d+(?:\.\d+)*\b/i.test(line)) return false;
      if (/^(?:references|bibliography|works cited|literature cited)\b/i.test(line)) return false;
      if (/^[A-Z][A-Za-z'-]+,\s+[A-Z](?:\.|\s)/.test(line) && /\b(?:19|20)\d{2}\b/.test(line)) return false;
      if (/[!?.,]{2,}/.test(line) || /\b(\w+)\s+\1\b/i.test(line)) return false;
      // A long unspaced all-caps token is usually a merged heading/layout artifact.
      if (/\b[A-Z]{18,}\b/.test(line)) return false;
      return true;
    })
    .join(" ");

  // Protect common abbreviations and numbers from regex period splitting
  const protectedText = cleaned
    .replace(/\b(e\.g|i\.e|vs|etc|fig|dr|mr|mrs|ms|prof|dept|no|approx|est)\./gi, "$1_DOT_")
    .replace(/\b([A-Z])\./g, "$1_DOT_")
    .replace(/(\d+)\.(\d+)/g, "$1_DECIMAL_$2");

  // Split only on terminal punctuation followed by whitespace and capital letter or quote
  const rawSplits = protectedText.split(/(?<=[.!?])\s+(?=[A-Z0-9"“'‘])/);

  const sentences: string[] = [];
  for (let s of rawSplits) {
    s = s
      .replace(/_DOT_/g, ".")
      .replace(/_DECIMAL_/g, ".")
      .replace(/^[=\-#_~*\s]+/, "")
      .replace(/[=\-#_~*\s]+$/, "")
      .trim();

    // 1. Minimum 25 characters, maximum 180 characters
    if (s.length < 25 || s.length > 180) continue;

    // 2. Must start with a capital letter or quote
    if (!/^[A-Z"“'‘]/.test(s)) continue;

    // 3. Must end with terminal punctuation
    if (!/[.!?]["”'’]?$/.test(s)) continue;

    // Source questions, captions and reference fragments are not answer evidence.
    if (/^(?:how|what|why|when|where|which|who|fig(?:ure)?|table|references|bibliography)\b/i.test(s)) continue;
    // Common OCR/list fragments often pass punctuation checks despite not being
    // complete statements (for example, "The 3D object specification, and 2.").
    if (/[,\uFF0C]\s*(?:and|or)\s+\d/i.test(s) || /\b(?:and|or|but|of|for|to|with|the|a|an)\s*[,.]?$/i.test(s)) continue;

    // 4. Must have balanced parentheses and brackets
    const openParen = (s.match(/\(/g) || []).length;
    const closeParen = (s.match(/\)/g) || []).length;
    if (openParen !== closeParen) continue;

    const openBracket = (s.match(/\[/g) || []).length;
    const closeBracket = (s.match(/\]/g) || []).length;
    if (openBracket !== closeBracket) continue;

    // 5. Must not start with conjunctions or incomplete fragments (e.g. "during a pair-programming...")
    if (/^(and|or|but|because|during|which|while|with|by|for)\b/i.test(s)) continue;

    // 6. Must not be just a section header label (e.g. "Problem Statement:")
    if (/^[A-Za-z0-9\s()_-]+:\s*$/.test(s)) continue;

    // 7. Must not be a metadata header line or title (e.g. "Subject: ...", "Purpose: ...", "Author: ...")
    if (
      /^(subject|purpose|author|document\s+title|title|course|overview|description|uploaded\s+by|copyright|all\s+rights\s+reserved|system\s+instruction|sample\s+notes)\s*:/i.test(s) ||
      /^(sample\s+notes\s+for\s+testing|notes\s+prepared\s+by|table\s+of\s+contents)\b/i.test(s)
    ) {
      continue;
    }

    sentences.push(s);
  }

  if (sentences.length === 0 && cleaned.length >= 25) {
    const trimmed = cleaned.replace(/^[=\-#_~*\s]+/, "").replace(/[=\-#_~*\s]+$/, "").trim();
    if (
      trimmed.length >= 25 &&
      /^[A-Z"“'‘]/.test(trimmed) &&
      !/^(and|or|but|because|during|which|while|with|by|for)\b/i.test(trimmed) &&
      !/^(?:how|what|why|when|where|which|who|fig(?:ure)?|table|references|bibliography)\b/i.test(trimmed) &&
      !/^(subject|purpose|author|document\s+title|title|course|overview|description|uploaded\s+by|copyright|all\s+rights\s+reserved|system\s+instruction|sample\s+notes)\s*:/i.test(trimmed) &&
      !/^(sample\s+notes\s+for\s+testing|notes\s+prepared\s+by|table\s+of\s+contents)\b/i.test(trimmed)
    ) {
      sentences.push(trimmed);
    }
  }

  return sentences;
}

/**
 * Derives document-adaptive topic suggestions dynamically from a document's actual chunks.
 * Inspects headings, cleans numeric and generic prefixes, extracts lead concepts from text,
 * and falls back gracefully when structure is sparse.
 */
export function getDocumentTopics(
  documentId: string,
  dbInstance?: DatabaseSync,
): DocumentTopicSuggestion[] {
  const db = dbInstance ?? openDb();
  const shouldClose = !dbInstance;
  try {
    const docRow = db
      .prepare("SELECT id, title, origin FROM documents WHERE id = ?")
      .get(documentId) as { id: string; title: string; origin: string } | undefined;

    if (!docRow) return [];

    const chunkRows = db
      .prepare(
        "SELECT id, heading, text, ordinal FROM chunks WHERE document_id = ? ORDER BY ordinal ASC",
      )
      .all(documentId) as Array<{ id: string; heading: string; text: string; ordinal: number }>;

    if (chunkRows.length === 0) return [];

    const suggestions: DocumentTopicSuggestion[] = [];
    const seen = new Set<string>();

    for (const chunk of chunkRows) {
      const rawHeading = chunk.heading || "";
      let clean = rawHeading
        .replace(/^[=\-#_~*\s]+/, "")
        .replace(/[=\-#_~*\s]+$/, "")
        .replace(/^(section|chapter)\s+[0-9.]+\s*:?\s*/i, "")
        .replace(/^[0-9]+[.:\-\s]+/, "")
        .trim();

      // If heading is generic, attempt to discover concept title from chunk text
      if (!clean || /^(section|chapter)\s+[0-9.]+/i.test(clean) || clean.toLowerCase() === "overview") {
        clean = "";
        const firstLine = chunk.text.split(/\r?\n/)[0]?.trim() || "";
        const numMatch = firstLine.match(
          /^[0-9]+[.:\-\s]+([A-Za-z0-9\s&/()\-–—]{3,50})(?:\s+(?:Problem|Background|Overview|Definition|Analysis):|[\r\n.]|$)/i,
        );
        const colonMatch = firstLine.match(/^([A-Za-z0-9\s&/()\-–—]{3,40}):/);
        const allCapsMatch = firstLine.match(/^([A-Z0-9\s&/()\-–—]{4,40})(?:\s+[a-z]|\.|$)/);

        if (numMatch && numMatch[1] && numMatch[1].trim().length >= 3) {
          clean = numMatch[1].trim();
        } else if (colonMatch && colonMatch[1] && colonMatch[1].trim().length >= 3) {
          clean = colonMatch[1].trim();
        } else if (allCapsMatch && allCapsMatch[1] && allCapsMatch[1].trim().length >= 3) {
          clean = allCapsMatch[1].trim();
        } else if (!/[.!?]/.test(firstLine) && firstLine.length <= 50) {
          // Take first 3-4 words if informative heading phrase without terminal punctuation
          const words = firstLine.split(/\s+/).slice(0, 4).join(" ");
          if (
            words.length >= 4 &&
            words.length <= 40 &&
            !/^(the|a|an|in|on|at|for|to)\b/i.test(words)
          ) {
            clean = words.replace(/[.:;,-]+$/, "").trim();
          }
        }
      }

      if (clean && clean.length >= 3 && clean.length <= 60) {
        const lower = clean.toLowerCase();
        if (!seen.has(lower) && !lower.startsWith("section") && !lower.startsWith("chapter")) {
          seen.add(lower);
          suggestions.push({
            id: chunk.id,
            label: clean,
            topic: clean,
            chunkId: chunk.id,
          });
        }
      }
    }

    if (suggestions.length === 0) {
      suggestions.push({
        id: `${documentId}#full`,
        label: "Study Full Document",
        topic: "Study Full Document",
        chunkId: chunkRows[0]?.id,
      });
    }

    return suggestions.slice(0, 6);
  } finally {
    if (shouldClose) {
      db.close();
    }
  }
}

export const fetchDocumentTopicSuggestions = getDocumentTopics;

export interface ConceptQuestionTemplate {
  pattern: RegExp;
  prompt: string;
  distractors: string[];
  preferredSentenceMatch?: RegExp;
}

export const DBMS_CONCEPT_TEMPLATES: ConceptQuestionTemplate[] = [
  {
    pattern: /\b(2nf|second\s+normal\s+form|partial\s+(functional\s+)?dependenc)/i,
    prompt: "Which condition must a relation satisfy to be in Second Normal Form (2NF)?",
    preferredSentenceMatch: /\b(second\s+normal\s+form|partial\s+functional\s+dependenc|composite\s+candidate\s+key)\b/i,
    distractors: [
      "Every determinant of every non-trivial functional dependency must strictly be a superkey.",
      "No non-prime attribute may depend transitively on any candidate key in the relation.",
      "Every non-prime attribute is permitted to depend on only a proper subset of a composite candidate key.",
    ],
  },
  {
    pattern: /\b(1nf|first\s+normal\s+form|atomic\s+value|repeating\s+group)/i,
    prompt: "Which requirement must a relation meet to satisfy First Normal Form (1NF)?",
    preferredSentenceMatch: /\b(first\s+normal\s+form|atomic\s+value|repeating\s+group)\b/i,
    distractors: [
      "Every non-prime attribute must be fully functionally dependent on every candidate key.",
      "All transitive dependencies between non-key attributes must be eliminated.",
      "Every non-trivial functional dependency determinant must strictly be a superkey.",
    ],
  },
  {
    pattern: /\b(3nf|third\s+normal\s+form|transitive\s+dependenc)/i,
    prompt: "Which condition must a relation satisfy to be in Third Normal Form (3NF)?",
    preferredSentenceMatch: /\b(third\s+normal\s+form|transitive\s+dependenc|superkey\s+or\s+a\s+is\s+a\s+prime)\b/i,
    distractors: [
      "Every determinant of every non-trivial functional dependency must strictly be a superkey.",
      "Non-prime attributes are allowed to depend on a proper subset of a composite key.",
      "Each table attribute may store lists, repeating groups, or multiple values in one cell.",
    ],
  },
  {
    pattern: /\b(bcnf|boyce[- ]codd)/i,
    prompt: "What condition does Boyce-Codd Normal Form (BCNF) require for all functional dependencies?",
    preferredSentenceMatch: /\b(boyce[- ]codd|bcnf|every\s+determinant)\b/i,
    distractors: [
      "Determinants only need to be superkeys if the dependent attribute is a non-prime attribute.",
      "Relations only eliminate partial dependencies while permitting transitive dependencies.",
      "Composite candidate keys are strictly prohibited in all normalized relational schemas.",
    ],
  },
  {
    pattern: /\b(durability|crash\s+or\s+restart|committed\s+changes\s+persist)/i,
    prompt: "What does the Durability property in the ACID framework guarantee?",
    preferredSentenceMatch: /\b(durability|committed\s+changes\s+persist|crash\s+or\s+restart)\b/i,
    distractors: [
      "A transaction executes in an all-or-nothing manner and aborts completely upon failure.",
      "Concurrent transactions execute without observing uncommitted intermediate states.",
      "Database constraints and integrity rules are evaluated only after scheduled restarts.",
    ],
  },
  {
    pattern: /\b(acid(\s+properties)?|atomicity|isolation\s+guarantees|consistency)/i,
    prompt: "Which guarantees are provided by the ACID properties in database transactions?",
    preferredSentenceMatch: /\b(acid|atomicity|consistency|isolation|durability)\b/i,
    distractors: [
      "Transactions are allowed to commit partially if an unexpected crash interrupts processing.",
      "Concurrent transactions are permitted to observe dirty, uncommitted rows by default.",
      "Committed modifications are rolled back automatically whenever database services restart.",
    ],
  },
  {
    pattern: /\b(deadlock|deadlocks|wait\s+in\s+a\s+cycle)/i,
    prompt: "How does a deadlock condition arise between concurrent transactions?",
    preferredSentenceMatch: /\b(deadlock|wait\s+in\s+a\s+cycle|cycle\s+for\s+resources)\b/i,
    distractors: [
      "Transactions execute sequentially without holding or waiting for any shared resource locks.",
      "A schedule is conflict-serializable and its precedence graph contains no directed cycles.",
      "All transactions commit simultaneously without requesting shared or exclusive locks.",
    ],
  },
  {
    pattern: /\b(transaction\s+is\s+a\s+logical\s+unit|transactions\s+and\s+concurrency|concurrency\s+control)/i,
    prompt: "How is a database transaction defined according to your study notes?",
    preferredSentenceMatch: /\b(logical\s+unit|transaction\s+is)\b/i,
    distractors: [
      "A transaction is an individual SQL statement that always commits immediately without rollback capability.",
      "A transaction is an uncommitted sequence of database reads that cannot acquire shared or exclusive locks.",
      "A transaction is a database checkpoint process that logs memory buffers only upon server restart.",
    ],
  },
  {
    pattern: /\b(database\s+normalization|redundancy\s+and\s+prevent|insertion,\s*update,\s*and\s*deletion\s*anomalies)/i,
    prompt: "What is the primary purpose of database normalization?",
    preferredSentenceMatch: /\b(normalization|redundancy|anomalies)\b/i,
    distractors: [
      "To denormalize relations into a single table to eliminate all relational join operations.",
      "To enforce strict B-tree indexing on every table attribute regardless of query workload.",
      "To guarantee transactional ACID durability by writing log records directly to external replication nodes.",
    ],
  },
  {
    pattern: /\b(foreign\s+key|referential\s+integrity)/i,
    prompt: "What is the role of a foreign key and referential integrity in a database?",
    preferredSentenceMatch: /\b(foreign\s+key|referential\s+integrity)\b/i,
    distractors: [
      "A foreign key creates physical copies of parent rows directly inside the child relation.",
      "Referential integrity requires all child foreign keys to be composite candidate keys in the parent relation.",
      "A foreign key automatically deletes all candidate keys in the parent relation whenever child records are updated.",
    ],
  },
  {
    pattern: /\b(primary\s+key|uniquely\s+identifies\s+each\s+row)/i,
    prompt: "What requirement must a primary key satisfy in a relational database table?",
    preferredSentenceMatch: /\b(primary\s+key|uniquely\s+identifies)\b/i,
    distractors: [
      "A primary key permits multiple NULL values to represent optional rows.",
      "A primary key must contain duplicate values across partitioned tables.",
      "A primary key allows child foreign keys to reference nonexistent records.",
    ],
  },
  {
    pattern: /\b(index|indexing|auxiliary\s+data\s+structure|speed\s+up\s+data\s+retrieval)/i,
    prompt: "What fundamental trade-off is associated with using a database index?",
    preferredSentenceMatch: /\b(index|auxiliary|speed\s+up)\b/i,
    distractors: [
      "An index speeds up inserts and updates while slowing down read-only select queries.",
      "An index eliminates the need for query planners and secondary disk storage.",
      "An index guarantees that tables automatically satisfy Boyce-Codd Normal Form.",
    ],
  },
];

/**
 * Generates verified question stubs for chunks so that `generate_quiz` and `evaluate_answer`
 * can deliver grounded quizzes for uploaded documents.
 */
function cleanChoiceText(text: string): string {
  return text
    .replace(/^[-*•\d.)\s]+/, "")
    .replace(/[*_#`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hashString(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function questionConceptName(heading: string, preferredTopic?: string): string | undefined {
  const clean = (value: string) => value
    .replace(/^(?:what\s+is|define|explain|describe|teach\s+me\s+about|quiz\s+me\s+on)\s+/i, "")
    .replace(/^(?:section|chapter)\s+\d+(?:\.\d+)*\s*[:.-]?\s*/i, "")
    .replace(/^\d+(?:\.\d+)*[\s:.-]+/, "")
    .replace(/\b(?:overview|objectives?|learning outcomes?|introduction|notes?)\b/gi, " ")
    .replace(/[?!.,]+$/, "")
    .replace(/[\s:–—-]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  const meaningful = (value: string) => value.length >= 3 &&
    !/^(?:section|chapter|unit|overview|this concept|study material)\s*\d*$/i.test(value) &&
    !/\b(?:and|or|but|of|for|to|with|the|a|an)$/i.test(value);

  const requested = preferredTopic ? clean(preferredTopic) : "";
  if (meaningful(requested)) return requested.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());

  const fromHeading = clean(heading.replace(/^[=\-#_~*\s]+|[=\-#_~*\s]+$/g, ""));
  if (meaningful(fromHeading)) return fromHeading.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());

  return undefined;
}

function conceptNameFromEvidence(quote: string): string | undefined {
  const match = /^(?:a|an|the)\s+(.+?)\s+(?:is|are|occurs|happens|means|refers to|describes)\b/i.exec(quote);
  const concept = match?.[1]?.trim();
  return concept && concept.length <= 60 ? concept.replace(/\b[a-z]/g, (letter) => letter.toUpperCase()) : undefined;
}

function isLearningObjectiveOrCaption(sentence: string): boolean {
  return /^(?:(?:in|by)\s+this\s+(?:unit|chapter|section)|(?:the\s+)?(?:learning\s+)?objectives?\b|(?:after\s+completing|at\s+the\s+end\s+of)\b|fig(?:ure)?\s*\.?\s*\d|table\s*\d)\b/i.test(sentence) ||
    /\b(?:we aim to|students will be able to|you will learn to|learning objectives?)\b/i.test(sentence) ||
    /\bobjectives?\b/i.test(sentence);
}

export function createQuestionForChunk(
  chunk: SourceChunk,
  conceptId: string,
  preferredTopic?: string,
  allChunks?: SourceChunk[],
  forceCorrectIndex?: number,
  requestedFormat?: "multiple_choice" | "short_answer",
): {
  id: string;
  conceptId: string;
  kind: "multiple_choice" | "short_answer";
  prompt: string;
  choices: string[];
  expected: QuestionRubric;
  evidenceQuote: string;
  evidenceStart: number;
  evidenceEnd: number;
} | null {
  // Extract grammatically clean sentences with abbreviation protection and balanced delimiter checks
  const sentences = extractCleanSentences(chunk.text).filter((sentence) => !isLearningObjectiveOrCaption(sentence));

  if (sentences.length === 0) return null;

  // Search context: combined string of preferredTopic, heading, and text
  const contextSearch = `${preferredTopic ?? ""} ${chunk.heading} ${chunk.text}`.toLowerCase();

  // Only apply DBMS concept templates to documents/sections covering DBMS / Database concepts
  const isDbmsDocument =
    /\b(normalization|normal form|1nf|2nf|3nf|bcnf|relational|database|sql|acid|transaction|concurrency|deadlock|foreign key|primary key|index)\b/i.test(
      `${chunk.heading} ${chunk.text}`,
    );

  const matchedTemplate = isDbmsDocument
    ? DBMS_CONCEPT_TEMPLATES.find((tpl) => tpl.pattern.test(contextSearch))
    : undefined;

  if (requestedFormat === "multiple_choice" && !matchedTemplate) return null;

  let quote = sentences[0]!;
  let prompt = "";
  let distractors: string[] = [];

  if (matchedTemplate) {
    prompt = matchedTemplate.prompt;

    // Pick best matching sentence for this template
    if (matchedTemplate.preferredSentenceMatch) {
      const candidate = sentences.find((s) => matchedTemplate.preferredSentenceMatch!.test(s));
      if (candidate) {
        quote = candidate;
      }
    } else if (preferredTopic) {
      const candidate = sentences.find((s) => s.toLowerCase().includes(preferredTopic.toLowerCase()));
      if (candidate) {
        quote = candidate;
      }
    }

    distractors = [...matchedTemplate.distractors];
  } else {
    // General document-adaptive question generation for non-DBMS concepts
    const conceptName = questionConceptName(chunk.heading, preferredTopic) || conceptNameFromEvidence(quote);
    if (!conceptName) return null;
    const conceptTerms = conceptName.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 2);
    const searchableEvidence = `${chunk.heading} ${quote}`.toLowerCase();
    if (conceptTerms.length > 0 && !conceptTerms.some((term) => searchableEvidence.includes(term))) return null;

    prompt = `What is ${conceptName}, and how does it work according to your study notes?`;

    // Sibling excerpts are not necessarily plausible distractors for this concept.
    // Without a concept-specific validated distractor set, use the short-answer path.
    distractors = [];
  }

  // Evidence verification check
  const verifier = new DefaultEvidenceVerifier();
  let verification = verifier.verify({ chunkId: chunk.id, quote }, chunk);
  if (verification.status !== "verified" || verification.reference.start === undefined) {
    quote = sentences[0]!;
    verification = verifier.verify({ chunkId: chunk.id, quote }, chunk);
    if (verification.status !== "verified" || verification.reference.start === undefined) {
      return null;
    }
  }

  // Keep persisted question IDs compact. Chunk IDs include document IDs and
  // human-readable headings, which can exceed the API's reasonable key size.
  const qId = `q_up_${createHash("sha256").update(chunk.id, "utf8").digest("hex").slice(0, 32)}`;
  const cleanedQuote = cleanChoiceText(quote);
  const cleanedDistractors = distractors.map(cleanChoiceText).filter(
    (d) =>
      d.length >= 20 &&
      d.toLowerCase() !== cleanedQuote.toLowerCase() &&
      !d.includes("...") &&
      !d.includes("…") &&
      !/^the opposite of/i.test(d),
  );

  // Quality guardrails:
  // 1. Must have at least 3 distinct, defensible distractors
  // 2. Distractors must not duplicate the quote
  // If not satisfied, fall back cleanly to short_answer format without guessing
  if (
    requestedFormat === "short_answer" ||
    cleanedDistractors.length < 3 ||
    new Set(cleanedDistractors.map((d) => d.toLowerCase())).size < 3
  ) {
    return {
      id: qId,
      conceptId,
      kind: "short_answer",
      prompt: prompt.endsWith("?")
        ? prompt
        : `What is ${questionConceptName(chunk.heading, preferredTopic)}, according to your study notes?`,
      choices: [],
      expected: {
        kind: "short_answer",
        correctAnswer: quote,
        acceptableVariants: [quote],
        explanation: `Key excerpt from your notes: "${quote}"`,
      },
      evidenceQuote: quote,
      evidenceStart: verification.reference.start,
      evidenceEnd: verification.reference.end ?? verification.reference.start + quote.length,
    };
  }

  // Deterministic permutation: distribute correct answer across positions A, B, C, D (0, 1, 2, 3)
  const targetIndex =
    forceCorrectIndex !== undefined
      ? ((forceCorrectIndex % 4) + 4) % 4
      : hashString(qId) % 4;

  const choices: string[] = new Array(4);
  choices[targetIndex] = cleanedQuote;
  let dIdx = 0;
  for (let i = 0; i < 4; i++) {
    if (i !== targetIndex) {
      choices[i] = cleanedDistractors[dIdx++]!;
    }
  }

  const correctLetter = String.fromCharCode(65 + targetIndex);

  return {
    id: qId,
    conceptId,
    kind: "multiple_choice",
    prompt,
    choices,
    expected: {
      kind: "multiple_choice",
      correctAnswer: correctLetter,
      acceptableVariants: [quote],
      explanation: `Verified quote directly from your notes: "${quote}"`,
    },
    evidenceQuote: quote,
    evidenceStart: verification.reference.start,
    evidenceEnd: verification.reference.end ?? verification.reference.start + quote.length,
  };
}

/**
 * Ingests an uploaded document into SQLite:
 * 1. Creates a document entry with origin = 'student-upload'.
 * 2. Chunks the text and stores chunks.
 * 3. Creates concept entries for headings.
 * 4. Generates grounded verified question stubs for quiz readiness.
 */
export async function ingestDocument(
  fileName: string,
  buffer: Buffer,
): Promise<IngestionResult> {
  let text = "";
  let format: "markdown" | "text" | "pdf" = "text";

  try {
    const extracted = await extractTextFromFile(fileName, buffer);
    text = extracted.text;
    format = extracted.format;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Failed to extract text from file.";
    return { fileName, success: false, error: errorMsg };
  }

  const cleanBase = fileName
    .slice(0, fileName.lastIndexOf(".") > 0 ? fileName.lastIndexOf(".") : undefined)
    .trim();
  const slug = headingToSlug(cleanBase) || "untitled-note";
  const documentId = `doc_${randomUUID()}_${slug}`;
  const title = cleanBase || "Untitled Study Note";

  let chunks: SourceChunk[] = [];
  if (format === "markdown") {
    chunks = chunkMarkdown(documentId, text);
    if (chunks.length === 0) {
      chunks = chunkPlainText(documentId, text);
    }
  } else {
    chunks = chunkPlainText(documentId, text);
  }

  // Heading slugs are not unique when a document repeats a section title.
  // Keep each chunk identity unique within this new document regardless of
  // repeated headings or rapid uploads with the same filename.
  chunks = chunks.map((chunk, index) => ({
    ...chunk,
    id: `${documentId}#${headingToSlug(chunk.heading) || "section"}-${index + 1}`,
  }));

  if (chunks.length === 0) {
    return {
      fileName,
      success: false,
      error: "No readable content or sections could be extracted from this document.",
    };
  }

  const db = openDb();
  try {
    db.exec("BEGIN");

    // 1. Insert document
    const insertDoc = db.prepare(
      "INSERT INTO documents (id, title, origin) VALUES (?, ?, 'student-upload')",
    );
    insertDoc.run(documentId, title);

    // 2. Insert chunks
    const insertChunk = db.prepare(
      `INSERT INTO chunks (id, document_id, heading, ordinal, text, content_hash)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );

    // 3. Insert concepts & questions
    const insertConcept = db.prepare(
      "INSERT OR IGNORE INTO concepts (id, title, document_id) VALUES (?, ?, ?)",
    );
    const insertQuestion = db.prepare(
      `INSERT OR IGNORE INTO questions (
        id, concept_id, kind, prompt, choices_json, expected_json,
        evidence_chunk_id, evidence_quote, evidence_start, evidence_end, verified_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    let conceptCount = 0;
    const nowIso = new Date().toISOString();

    for (const chunk of chunks) {
      const contentHash = createHash("sha256").update(chunk.text, "utf8").digest("hex");
      insertChunk.run(
        chunk.id,
        chunk.documentId,
        chunk.heading,
        chunk.ordinal,
        chunk.text,
        contentHash,
      );

      const conceptId = `${documentId}__${headingToSlug(chunk.heading)}`;
      insertConcept.run(conceptId, `${title}: ${chunk.heading}`, documentId);
      conceptCount++;

      // Seed verified question stub
      const question = createQuestionForChunk(chunk, conceptId, undefined, chunks);
      if (question) {
        insertQuestion.run(
          question.id,
          question.conceptId,
          question.kind,
          question.prompt,
          question.choices ? JSON.stringify(question.choices) : null,
          JSON.stringify(question.expected),
          chunk.id,
          question.evidenceQuote,
          question.evidenceStart,
          question.evidenceEnd,
          nowIso,
        );
      }
    }

    db.exec("COMMIT");

    return {
      fileName,
      success: true,
      documentId,
      title,
      chunkCount: chunks.length,
      conceptCount,
    };
  } catch (err: unknown) {
    db.exec("ROLLBACK");
    const msg = err instanceof Error ? err.message : "Database ingestion error.";
    return { fileName, success: false, error: msg };
  } finally {
    db.close();
  }
}

/**
 * Returns all documents currently in the SQLite library.
 */
export function listDocuments(): DocumentInfo[] {
  const db = openDb();
  try {
    const rows = db
      .prepare(
        `SELECT d.id, d.title, d.origin, d.created_at as createdAt,
                COUNT(DISTINCT c.id) as chunkCount,
                COUNT(DISTINCT con.id) as conceptCount
         FROM documents d
         LEFT JOIN chunks c ON c.document_id = d.id
         LEFT JOIN concepts con ON con.document_id = d.id
         GROUP BY d.id
         ORDER BY d.origin DESC, d.created_at DESC`,
      )
      .all() as unknown as Array<{
        id: string;
        title: string;
        origin: "sample" | "student-upload";
        createdAt: string;
        chunkCount: number;
        conceptCount: number;
      }>;

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      origin: r.origin,
      chunkCount: Number(r.chunkCount),
      conceptCount: Number(r.conceptCount),
      createdAt: r.createdAt,
      suggestedTopics: getDocumentTopics(r.id, db),
    }));
  } finally {
    db.close();
  }
}

/**
 * Deletes a student-uploaded document and cascades to its chunks, concepts, and questions.
 * Refuses to delete 'sample' notes.
 */
export function deleteDocument(documentId: string): { success: boolean; message: string } {
  const db = openDb();
  try {
    const doc = db
      .prepare("SELECT id, origin, title FROM documents WHERE id = ?")
      .get(documentId) as { id: string; origin: string; title: string } | undefined;

    if (!doc) {
      return { success: false, message: `Document "${documentId}" not found.` };
    }

    if (doc.origin === "sample") {
      return { success: false, message: "Built-in sample DBMS notes cannot be deleted." };
    }

    db.exec("BEGIN");
    // Cascading deletes on chunks and concepts handle related rows
    db.prepare("DELETE FROM documents WHERE id = ?").run(documentId);
    db.exec("COMMIT");

    return {
      success: true,
      message: `Successfully removed document "${doc.title}" from your study library.`,
    };
  } catch (err: unknown) {
    db.exec("ROLLBACK");
    const msg = err instanceof Error ? err.message : "Failed to delete document.";
    return { success: false, message: msg };
  } finally {
    db.close();
  }
}
