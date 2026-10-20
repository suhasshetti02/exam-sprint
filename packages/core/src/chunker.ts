/**
 * Splits a Markdown document into retrievable chunks on `#`-level headings.
 *
 * Normalisation policy (documented here; used by EvidenceVerifier too):
 *   - Collapse all runs of whitespace (including \r\n, \t) to a single space.
 *   - Trim leading and trailing whitespace from the result.
 *   - Comparison is case-insensitive.
 *
 * Chunk IDs are stable: `<documentId>#<heading-slug>`.
 * Heading slug = heading text lowercased, spaces → hyphens, non-[a-z0-9-] removed.
 * If two headings produce the same slug (rare), ordinal is appended: `<slug>-2`.
 *
 * The function must stay free of FS, Node-only, and framework imports.
 */

import type { SourceChunk } from "./domain";

/**
 * Strips YAML front-matter (`---` … `---`) from the beginning of a Markdown string.
 * Returns the body text.
 */
function stripFrontmatter(md: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(md);
  return match ? md.slice(match[0].length) : md;
}

/**
 * Converts a heading text to a URL/ID-safe slug.
 * e.g. "Boyce-Codd normal form" → "boyce-codd-normal-form"
 */
export function headingToSlug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Splits a single Markdown document into `SourceChunk[]`.
 *
 * @param documentId - stable document identifier (from frontmatter `id:` or caller-supplied)
 * @param markdown   - full raw Markdown text (may include YAML front-matter)
 * @returns ordered array of chunks; empty array if there are no headings
 */
export function chunkMarkdown(documentId: string, markdown: string): SourceChunk[] {
  if (!documentId || !documentId.trim()) {
    throw new Error("chunkMarkdown: documentId must be a non-empty string");
  }

  const body = stripFrontmatter(markdown);

  // Split on any line that starts with one or more `#` followed by a space.
  // Keep the delimiter so we know the heading text.
  const segments = body.split(/^(#{1,6} .+)$/m);

  const chunks: SourceChunk[] = [];
  const slugCount = new Map<string, number>();
  let ordinal = 0;

  // `segments` alternates: [text-before-first-heading, heading, text, heading, text, …]
  // We only care about heading + following text pairs.
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i] ?? "";
    if (!/^#{1,6} /.test(segment)) continue;

    const headingText = segment.replace(/^#+\s+/, "").trim();
    const rawText = segments[i + 1] ?? "";
    // Collapse and trim the chunk body text.
    const text = rawText.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();

    if (!text) continue; // skip headings with no body

    const baseSlug = headingToSlug(headingText);
    const count = slugCount.get(baseSlug) ?? 0;
    slugCount.set(baseSlug, count + 1);
    const slug = count === 0 ? baseSlug : `${baseSlug}-${count + 1}`;

    chunks.push({
      id: `${documentId}#${slug}`,
      documentId,
      heading: headingText,
      ordinal: ordinal++,
      text,
    });
  }

  return chunks;
}
