import { NextResponse } from "next/server";
import {
  deleteDocument,
  getDocumentTopics,
  ingestDocument,
  listDocuments,
  MAX_FILE_SIZE_BYTES,
  type IngestionResult,
} from "@/lib/server/document-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/documents - Returns all documents in the active study library, or topics for a specific documentId.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const documentId = searchParams.get("documentId");

    const documents = listDocuments();

    if (documentId) {
      const doc = documents.find((d) => d.id === documentId);
      const topics = getDocumentTopics(documentId);
      return NextResponse.json({
        document: doc,
        topics,
        documents,
      });
    }

    return NextResponse.json({ documents });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load documents";
    return NextResponse.json({ error: "database_error", message }, { status: 500 });
  }
}

/**
 * POST /api/documents - Uploads one or multiple personal study files (.pdf, .txt, .md).
 */
export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const files = formData.getAll("files") as File[];

    if (!files || files.length === 0) {
      return NextResponse.json(
        { error: "no_files", message: "No files were provided in the upload request." },
        { status: 400 },
      );
    }

    const results: IngestionResult[] = [];

    for (const file of files) {
      const fileName = file.name || "uploaded-file";

      if (file.size === 0) {
        results.push({
          fileName,
          success: false,
          error: "File is empty (0 bytes).",
        });
        continue;
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        results.push({
          fileName,
          success: false,
          error: `File exceeds maximum allowed size of ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB.`,
        });
        continue;
      }

      try {
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const result = await ingestDocument(fileName, buffer);
        results.push(result);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to process file.";
        results.push({
          fileName,
          success: false,
          error: msg,
        });
      }
    }

    const successfulCount = results.filter((r) => r.success).length;
    const documents = listDocuments();

    return NextResponse.json({
      summary: `Processed ${files.length} file(s): ${successfulCount} successfully indexed.`,
      results,
      documents,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected upload error";
    return NextResponse.json({ error: "upload_failed", message }, { status: 500 });
  }
}

/**
 * DELETE /api/documents - Deletes a student-uploaded document by documentId.
 */
export async function DELETE(req: Request) {
  try {
    const { documentId } = await req.json();

    if (!documentId || typeof documentId !== "string") {
      return NextResponse.json(
        { error: "invalid_request", message: "documentId is required." },
        { status: 400 },
      );
    }

    const result = deleteDocument(documentId);
    if (!result.success) {
      return NextResponse.json({ error: "delete_failed", message: result.message }, { status: 400 });
    }

    const documents = listDocuments();
    return NextResponse.json({
      message: result.message,
      documents,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to delete document";
    return NextResponse.json({ error: "delete_failed", message }, { status: 500 });
  }
}
