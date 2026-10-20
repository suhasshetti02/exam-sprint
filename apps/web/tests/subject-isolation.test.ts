import { describe, expect, it, afterAll } from "vitest";
import {
  ingestDocument,
  deleteDocument,
  fetchDocumentTopicSuggestions,
  createQuestionForChunk,
} from "../lib/server/document-service";
import type { SourceChunk } from "@exam-sprint/core";

describe("Requirement 7: Document-Grounded Topic Discovery & Subject Isolation", () => {
  const createdDocIds: string[] = [];

  const DBMS_NOTES = `DATABASE MANAGEMENT SYSTEMS
# 1. Database Normalization
Relational databases store structured data in tables with rows and columns.
Database normalization reduces redundancy through normal forms including 1NF, 2NF, and 3NF.

# 2. ACID Properties
ACID properties guarantee reliability: Atomicity, Consistency, Isolation, and Durability.
Database transactions use locking protocols and write-ahead logging to prevent data loss.`;

  const OS_NOTES = `OPERATING SYSTEMS PRINCIPLES
# 1. Process Scheduling
Process scheduling allocates CPU time slices using preemptive algorithms such as round-robin.

# 2. Virtual Memory
Virtual memory uses paging and page tables to map virtual addresses to physical RAM frames.

# 3. Semaphores and Mutexes
Semaphores and mutexes provide synchronization primitives to prevent race conditions.

# 4. Deadlocks
Deadlocks require four simultaneous conditions: mutual exclusion, hold and wait, no preemption, and circular wait.`;

  const NETWORKS_NOTES = `COMPUTER NETWORKING AND PROTOCOLS
# 1. OSI Reference Model
The OSI reference model defines seven abstraction layers from physical to application.

# 2. Transmission Control Protocol (TCP)
The Transmission Control Protocol (TCP) establishes reliable connections via a three-way handshake.

# 3. Domain Name System (DNS)
The Domain Name System (DNS) translates human-readable domain names into IP addresses.

# 4. Border Gateway Protocol (BGP)
Border Gateway Protocol (BGP) manages routing decisions across autonomous systems on the internet.`;

  const BIOLOGY_NOTES = `CELLULAR BIOLOGY AND GENETICS
# 1. Mitochondria and ATP
Mitochondria generate adenosine triphosphate through cellular respiration and oxidative phosphorylation.

# 2. Cell Membrane Structure
The cell membrane consists of a phospholipid bilayer with embedded transport proteins.

# 3. Mitosis and Division
Mitosis divides duplicated chromosomes into two identical daughter nuclei during somatic cell division.

# 4. DNA Genetics
Deoxyribonucleic acid stores genetic information encoded in adenine, thymine, cytosine, and guanine base pairs.`;

  afterAll(() => {
    for (const id of createdDocIds) {
      deleteDocument(id);
    }
  });

  it("1. Ingests DBMS document and generates DBMS-specific topics without cross-talk", async () => {
    const res = await ingestDocument("DBMS_Notes.txt", Buffer.from(DBMS_NOTES, "utf8"));
    expect(res.success).toBe(true);
    expect(res.documentId).toBeDefined();
    createdDocIds.push(res.documentId!);

    const topics = await fetchDocumentTopicSuggestions(res.documentId!);
    expect(topics.length).toBeGreaterThan(0);
    const combinedTopics = topics.map((t) => t.topic.toLowerCase()).join(" ");

    // Must contain database / DBMS concepts
    expect(combinedTopics).toMatch(/database|normalization|relational|acid/);
    // Must NOT contain OS, Networks, or Biology topics
    expect(combinedTopics).not.toContain("mitochondria");
    expect(combinedTopics).not.toContain("phospholipid");
    expect(combinedTopics).not.toContain("three-way handshake");
    expect(combinedTopics).not.toContain("virtual memory");
  });

  it("2. Ingests Operating Systems document and generates OS topics with clean distractors", async () => {
    const res = await ingestDocument("Operating_Systems.txt", Buffer.from(OS_NOTES, "utf8"));
    expect(res.success).toBe(true);
    expect(res.documentId).toBeDefined();
    createdDocIds.push(res.documentId!);

    const topics = await fetchDocumentTopicSuggestions(res.documentId!);
    expect(topics.length).toBeGreaterThan(0);
    const combinedTopics = topics.map((t) => t.topic.toLowerCase()).join(" ");

    // Must contain OS concepts
    expect(combinedTopics).toMatch(/process|virtual memory|semaphores|deadlocks/);
    // Must NOT contain DBMS or Biology topics
    expect(combinedTopics).not.toContain("mitochondria");
    expect(combinedTopics).not.toContain("normalization");
    expect(combinedTopics).not.toContain("normal form");
    expect(combinedTopics).not.toContain("acid properties");

    // Verify question generation for OS chunk
    const osChunk: SourceChunk = {
      id: `${res.documentId}#c1`,
      documentId: res.documentId!,
      heading: "Virtual Memory",
      ordinal: 0,
      text: "Virtual memory uses paging and page tables to map virtual addresses to physical RAM frames. Process scheduling allocates CPU time slices using preemptive algorithms.",
    };

    const q = createQuestionForChunk(osChunk, "vm", "virtual memory");
    expect(q).not.toBeNull();
    expect(q?.prompt).toContain("Virtual Memory");
    // Choices must not leak DBMS normalization or biology
    const choicesText = q?.choices.join(" ").toLowerCase() || "";
    expect(choicesText).not.toContain("normal form");
    expect(choicesText).not.toContain("superkey");
    expect(choicesText).not.toContain("mitochondria");
  });

  it("3. Ingests Computer Networks document and produces network-grounded questions", async () => {
    const res = await ingestDocument("Computer_Networks.txt", Buffer.from(NETWORKS_NOTES, "utf8"));
    expect(res.success).toBe(true);
    expect(res.documentId).toBeDefined();
    createdDocIds.push(res.documentId!);

    const topics = await fetchDocumentTopicSuggestions(res.documentId!);
    expect(topics.length).toBeGreaterThan(0);
    const combinedTopics = topics.map((t) => t.topic.toLowerCase()).join(" ");

    // Must contain networking concepts
    expect(combinedTopics).toMatch(/osi|tcp|dns|border gateway/);
    // Must NOT contain DBMS or Biology topics
    expect(combinedTopics).not.toContain("normalization");
    expect(combinedTopics).not.toContain("mitochondria");

    const netChunk: SourceChunk = {
      id: `${res.documentId}#c1`,
      documentId: res.documentId!,
      heading: "Transmission Control Protocol",
      ordinal: 0,
      text: "The Transmission Control Protocol (TCP) establishes reliable connections via a three-way handshake. The Domain Name System (DNS) translates human-readable domain names into IP addresses.",
    };

    const q = createQuestionForChunk(netChunk, "tcp", "TCP");
    expect(q).not.toBeNull();
    expect(q?.choices).toHaveLength(4);
    const choicesText = q?.choices.join(" ").toLowerCase() || "";
    expect(choicesText).not.toContain("candidate key");
    expect(choicesText).not.toContain("mitochondria");
  });

  it("4. Ingests Biology document (non-CS) and confirms complete subject isolation", async () => {
    const res = await ingestDocument("Cellular_Biology.txt", Buffer.from(BIOLOGY_NOTES, "utf8"));
    expect(res.success).toBe(true);
    expect(res.documentId).toBeDefined();
    createdDocIds.push(res.documentId!);

    const topics = await fetchDocumentTopicSuggestions(res.documentId!);
    expect(topics.length).toBeGreaterThan(0);
    const combinedTopics = topics.map((t) => t.topic.toLowerCase()).join(" ");

    // Must contain biology concepts
    expect(combinedTopics).toMatch(/mitochondria|cell membrane|mitosis|deoxyribonucleic/);
    // Must NOT contain CS topics from previous uploads
    expect(combinedTopics).not.toContain("database");
    expect(combinedTopics).not.toContain("normalization");
    expect(combinedTopics).not.toContain("process scheduling");
    expect(combinedTopics).not.toContain("three-way handshake");

    const bioChunk: SourceChunk = {
      id: `${res.documentId}#c1`,
      documentId: res.documentId!,
      heading: "Mitochondria",
      ordinal: 0,
      text: "Mitochondria generate adenosine triphosphate through cellular respiration and oxidative phosphorylation. The cell membrane consists of a phospholipid bilayer with embedded transport proteins.",
    };

    const q = createQuestionForChunk(bioChunk, "mitochondria", "Mitochondria");
    expect(q).not.toBeNull();
    expect(q?.choices).toHaveLength(4);
    const choicesText = q?.choices.join(" ").toLowerCase() || "";
    expect(choicesText).not.toContain("relational");
    expect(choicesText).not.toContain("candidate key");
    expect(choicesText).not.toContain("scheduling");
  });
});
