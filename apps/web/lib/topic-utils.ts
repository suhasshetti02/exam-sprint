/**
 * Canonical topic and concept normalization utilities.
 * Client-safe and server-safe (no Node or React dependencies).
 */

export const TOPIC_CONCEPT_MAP: Record<string, string> = {
  // Normalization & FDs
  "normalization basics": "normalization-basics",
  "why normalize": "normalization-basics",
  "normalization": "normalization-basics",
  "normalise": "normalization-basics",
  "normalize": "normalization-basics",
  "anomalies": "normalization-basics",
  "update anomaly": "normalization-basics",
  "deletion anomaly": "normalization-basics",
  "insertion anomaly": "normalization-basics",

  "functional dependencies": "functional-dependencies",
  "functional dependency": "functional-dependencies",
  "closure": "functional-dependencies",
  "fd": "functional-dependencies",
  "fds": "functional-dependencies",
  "attribute closure": "functional-dependencies",

  "first normal form": "1nf",
  "1st normal form": "1nf",
  "1nf": "1nf",
  "atomic values": "1nf",
  "repeating groups": "1nf",

  "second normal form": "2nf",
  "2nd normal form": "2nf",
  "2nf": "2nf",
  "partial dependency": "2nf",
  "partial dependencies": "2nf",

  "third normal form": "3nf",
  "3rd normal form": "3nf",
  "3nf": "3nf",
  "transitive dependency": "3nf",
  "transitive dependencies": "3nf",

  "boyce-codd": "bcnf",
  "boyce codd": "bcnf",
  "bcnf": "bcnf",
  "candidate key": "bcnf",
  "superkey": "bcnf",

  // Transactions & Concurrency
  "acid transactions": "acid",
  "acid properties": "acid",
  "transactions": "acid",
  "transaction": "acid",
  "durability": "acid",
  "atomicity": "acid",
  "consistency": "acid",
  "acid": "acid",

  "isolation levels": "isolation-levels",
  "isolation level": "isolation-levels",
  "isolation": "isolation-levels",
  "serializable": "isolation-levels",
  "read committed": "isolation-levels",
  "read uncommitted": "isolation-levels",
  "repeatable read": "isolation-levels",
  "dirty read": "isolation-levels",
  "dirty reads": "isolation-levels",
};

export const SUPPORTED_CONCEPTS = [
  "1nf",
  "2nf",
  "3nf",
  "bcnf",
  "functional-dependencies",
  "normalization-basics",
  "acid",
  "isolation-levels",
] as const;

export type SupportedConceptId = (typeof SUPPORTED_CONCEPTS)[number];

/**
 * Checks whether user input is requesting review of weak concepts or misconceptions.
 */
export function isWeakConceptsRequest(text?: string): boolean {
  if (!text) return false;
  const clean = text.toLowerCase().trim();
  return (
    clean === "weak" ||
    /\b(weak|misconception|misconceptions|review weak|retest weak|practice weak|review my weak)\b/i.test(clean)
  );
}

/**
 * Resolves a natural language topic string to a canonical concept ID.
 * Returns undefined if the topic was provided but does not match any syllabus concept.
 * Returns "normalization-basics" only if topic is empty/undefined.
 */
export function resolveConceptId(
  topic?: string,
  searchHitsHeading?: string,
): string | undefined {
  if (topic) {
    const clean = topic.toLowerCase().trim();
    if (TOPIC_CONCEPT_MAP[clean]) {
      return TOPIC_CONCEPT_MAP[clean];
    }

    // Sort keys by length descending to match specific multi-word keys first
    const sortedEntries = Object.entries(TOPIC_CONCEPT_MAP).sort(
      ([a], [b]) => b.length - a.length,
    );

    for (const [key, cId] of sortedEntries) {
      const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`\\b${escapedKey}\\b`, "i");
      if (regex.test(clean)) {
        return cId;
      }
    }
  }

  // Check top search hit heading if provided
  if (searchHitsHeading) {
    const heading = searchHitsHeading.toLowerCase();
    const sortedEntries = Object.entries(TOPIC_CONCEPT_MAP).sort(
      ([a], [b]) => b.length - a.length,
    );
    for (const [key, cId] of sortedEntries) {
      const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`\\b${escapedKey}\\b`, "i");
      if (regex.test(heading)) {
        return cId;
      }
    }
  }

  // If a topic was provided but did not match anything, do NOT return a fallback!
  if (topic && topic.trim().length > 0) {
    return undefined;
  }

  // Default initial session concept
  return "normalization-basics";
}

/**
 * Formats internal concept IDs or chunk IDs into human-readable labels for the UI
 * (e.g. doc_1792472146076_executive-summary__section-1 -> Executive Summary (Section 1))
 */
export function formatConceptOrChunkTitle(rawId?: string): string {
  if (!rawId) return "Concept";

  // Handle uploaded document chunk IDs: doc_<timestamp>_<slug>__section-<n>
  const docChunkMatch = rawId.match(/^doc_\d+_([a-zA-Z0-9_-]+)__section-(\d+)$/i);
  if (docChunkMatch && docChunkMatch[1]) {
    const slug = docChunkMatch[1]
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");
    return `${slug} (Section ${docChunkMatch[2]})`;
  }

  // Handle doc_<timestamp>_<slug>
  const docMatch = rawId.match(/^doc_\d+_([a-zA-Z0-9_-]+)$/i);
  if (docMatch && docMatch[1]) {
    const slug = docMatch[1]
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");
    return slug;
  }

  // Handle sec-<slug>
  if (rawId.startsWith("sec-")) {
    return rawId.replace(/^sec-/, "").replace(/[-_]+/g, " ").toUpperCase();
  }

  // Handle generic kebab-case or snake_case IDs (e.g. acid_properties, normalization-basics)
  if (rawId.includes("_") || rawId.includes("-")) {
    return rawId
      .replace(/[_-]+/g, " ")
      .trim()
      .split(" ")
      .map((w) => (w.length <= 4 && !w.includes(" ") ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
      .join(" ");
  }

  return rawId;
}

