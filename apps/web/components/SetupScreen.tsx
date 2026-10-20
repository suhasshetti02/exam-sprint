"use client";

import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  UploadCloud,
  FileText,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  RefreshCw,
  FolderSync,
} from "lucide-react";
import {
  deleteDocument,
  fetchDocuments,
  uploadDocuments,
  type DocumentInfo,
  type DocumentTopicSuggestion,
  type IngestionResult,
} from "@/lib/api-client";

export type LearningGoal = "teach" | "quiz" | "weak" | "full_document";

export interface SessionConfig {
  documentId: string;
  documentTitle: string;
  goal: LearningGoal;
  topic?: string;
  suggestedTopics?: DocumentTopicSuggestion[];
}

export interface SetupScreenProps {
  onStartSession: (config: SessionConfig) => void;
  previousSession?: {
    documentId: string;
    documentTitle: string;
    goal: LearningGoal;
    topic?: string;
    messageCount: number;
  } | null;
  onResumeSession?: () => void;
}

export function SetupScreen({
  onStartSession,
  previousSession,
  onResumeSession,
}: SetupScreenProps) {
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string>("dbms-normalization");
  const [selectedGoal, setSelectedGoal] = useState<LearningGoal>("teach");
  const [customTopic, setCustomTopic] = useState("");
  const [isLoadingDocs, setIsLoadingDocs] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResults, setUploadResults] = useState<IngestionResult[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [successMessage, setSuccessMessage] = useState<string | undefined>();

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Load document library on mount
  useEffect(() => {
    let active = true;

    fetchDocuments()
      .then((docs) => {
        if (!active) return;
        setDocuments(docs);
        if (docs.length > 0) {
          setSelectedDocId((prev) => (docs.some((d) => d.id === prev) ? prev : docs[0]!.id));
        }
      })
      .catch((err: unknown) => {
        if (!active) return;
        const msg = err instanceof Error ? err.message : "Failed to load study library.";
        setErrorMessage(msg);
      })
      .finally(() => {
        if (active) setIsLoadingDocs(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setErrorMessage(undefined);
    setSuccessMessage(undefined);
    setUploadResults([]);

    try {
      const fileArray = Array.from(files);
      const res = await uploadDocuments(fileArray);
      setUploadResults(res.results);
      setDocuments(res.documents);

      const successful = res.results.filter((r) => r.success);
      if (successful.length > 0) {
        setSuccessMessage(`Successfully indexed ${successful.length} document(s) into your study library.`);
        setSelectedDocId(successful[0]!.documentId!);
      } else {
        setErrorMessage("None of the uploaded files could be indexed. See details below.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to upload study files.";
      setErrorMessage(msg);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleDeleteDocument = async (docId: string, title: string) => {
    if (!confirm(`Are you sure you want to remove "${title}" from your library?`)) {
      return;
    }

    try {
      const res = await deleteDocument(docId);
      setDocuments(res.documents);
      setSuccessMessage(res.message);
      if (selectedDocId === docId && res.documents.length > 0) {
        setSelectedDocId(res.documents[0]!.id);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to delete document.";
      setErrorMessage(msg);
    }
  };

  const handleStart = () => {
    const selectedDoc = documents.find((d) => d.id === selectedDocId);
    const documentTitle = selectedDoc ? selectedDoc.title : "Sample DBMS Notes";

    onStartSession({
      documentId: selectedDocId,
      documentTitle,
      goal: selectedGoal,
      topic: customTopic.trim() || undefined,
      suggestedTopics: selectedDoc?.suggestedTopics,
    });
  };

  const selectedDoc = documents.find((d) => d.id === selectedDocId);

  return (
    <div className="flex flex-col h-full overflow-y-auto pr-1">
      <div className="max-w-4xl mx-auto w-full py-4 sm:py-6 space-y-6">
        {/* Welcome Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-semibold">
            <Sparkles className="size-3.5 text-amber-400" />
            <span>Alexa+-Inspired Adaptive Tutor</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-stone-100">
            Welcome to Exam Sprint
          </h1>
          <p className="text-xs sm:text-sm text-stone-400 max-w-xl mx-auto">
            Choose your study material and learning goal. All questions, explanations, and
            evaluations are strictly grounded in verified note quotations.
          </p>
        </div>

        {/* Previous Session Resume Card */}
        {previousSession && onResumeSession && (
          <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 flex flex-wrap items-center justify-between gap-3 shadow-lg">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <FolderSync className="size-4 text-amber-400" />
                <span className="text-xs font-bold text-amber-200">
                  Active Session Found
                </span>
                <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">
                  {previousSession.goal}
                </span>
              </div>
              <p className="text-xs text-stone-300">
                Material: <strong className="text-stone-100">{previousSession.documentTitle}</strong>
                {previousSession.topic ? ` • Topic: ${previousSession.topic}` : ""} ({previousSession.messageCount} messages)
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onResumeSession}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-1.5 text-xs font-bold text-stone-950 shadow-md hover:bg-amber-400 transition-all"
              >
                <span>Resume Session</span>
                <ArrowRight className="size-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Alerts */}
        {errorMessage && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="size-4 shrink-0 text-rose-400" />
              <span>{errorMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorMessage(undefined)}
              className="font-bold px-1 hover:opacity-75"
            >
              ✕
            </button>
          </div>
        )}

        {successMessage && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-4 shrink-0 text-emerald-400" />
              <span>{successMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setSuccessMessage(undefined)}
              className="font-bold px-1 hover:opacity-75"
            >
              ✕
            </button>
          </div>
        )}

        {/* Step 1: Choose Study Material */}
        <div className="warm-glass-panel rounded-2xl p-5 shadow-xl space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-800/80 pb-3">
            <div className="flex items-center gap-2.5">
              <span className="flex size-6 items-center justify-center rounded-md bg-amber-500/20 text-amber-400 font-bold text-xs">
                1
              </span>
              <h2 className="text-sm sm:text-base font-bold text-stone-100">
                Choose Study Material
              </h2>
            </div>
            <span className="text-[11px] text-stone-400">
              PDF, TXT, or Markdown supported
            </span>
          </div>

          {/* Upload Dropzone & Button */}
          <div className="grid sm:grid-cols-2 gap-3.5">
            <label
              htmlFor="study-file-upload-input"
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onDragEnter={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!isUploading && e.dataTransfer.files) {
                  handleFileUpload(e.dataTransfer.files);
                }
              }}
              className="border-2 border-dashed border-stone-800 hover:border-amber-500/50 rounded-xl p-4 flex flex-col items-center justify-center text-center cursor-pointer transition-all bg-stone-900/40 hover:bg-stone-900/70 select-none block"
            >
              <UploadCloud className="size-7 text-amber-400/80 mb-2 mx-auto" />
              <p className="text-xs font-semibold text-stone-200">
                Upload Personal Notes
              </p>
              <p className="text-[11px] text-stone-400 mt-0.5">
                Drop PDF, TXT, or MD here or click to browse
              </p>
              <input
                id="study-file-upload-input"
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.txt,.md,text/plain,text/markdown,application/pdf"
                className="hidden"
                onChange={(e) => {
                  handleFileUpload(e.target.files);
                }}
                disabled={isUploading}
              />
              {isUploading && (
                <div className="flex items-center justify-center gap-2 mt-2 text-xs text-amber-400">
                  <RefreshCw className="size-3.5 animate-spin" />
                  <span>Extracting & chunking notes...</span>
                </div>
              )}
            </label>

            {/* Document Library Selection */}
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              <span className="text-[11px] uppercase tracking-wider font-bold text-stone-500 block">
                Available Study Library:
              </span>
              {isLoadingDocs ? (
                <div className="p-4 text-center text-xs text-stone-500">
                  Loading library documents...
                </div>
              ) : documents.length === 0 ? (
                <div className="p-4 text-center text-xs text-stone-500 space-y-2">
                  <p>{errorMessage ? "Could not load library documents." : "No documents in library."}</p>
                  <button
                    type="button"
                    onClick={() => {
                      setIsLoadingDocs(true);
                      setErrorMessage(undefined);
                      fetchDocuments()
                        .then((docs) => {
                          setDocuments(docs);
                          if (docs.length > 0) {
                            setSelectedDocId((prev) => (docs.some((d) => d.id === prev) ? prev : docs[0]!.id));
                          }
                        })
                        .catch((err: unknown) => {
                          const msg = err instanceof Error ? err.message : "Failed to load study library.";
                          setErrorMessage(msg);
                        })
                        .finally(() => {
                          setIsLoadingDocs(false);
                        });
                    }}
                    className="px-2.5 py-1 rounded bg-stone-800 hover:bg-stone-700 text-stone-300 hover:text-stone-100 text-[11px] transition-colors"
                  >
                    Retry loading
                  </button>
                </div>
              ) : (
                documents.map((doc) => {
                  const isSelected = selectedDocId === doc.id;
                  const isSample = doc.origin === "sample";

                  return (
                    <div
                      key={doc.id}
                      onClick={() => {
                        setSelectedDocId(doc.id);
                        setCustomTopic("");
                      }}
                      className={`rounded-xl p-2.5 border transition-all cursor-pointer flex items-center justify-between gap-2 ${
                        isSelected
                          ? "bg-amber-500/10 border-amber-500/50 shadow-sm"
                          : "bg-stone-900/60 border-stone-800/80 hover:border-stone-700"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {isSample ? (
                          <BookOpen className="size-4 text-amber-400 shrink-0" />
                        ) : (
                          <FileText className="size-4 text-emerald-400 shrink-0" />
                        )}
                        <div className="truncate">
                          <p className="text-xs font-semibold text-stone-200 truncate">
                            {doc.title}
                          </p>
                          <p className="text-[10px] text-stone-400 flex items-center gap-1.5 mt-0.5">
                            <span
                              className={`px-1 rounded text-[9px] font-semibold ${
                                isSample
                                  ? "bg-stone-800 text-stone-300"
                                  : "bg-emerald-950/60 text-emerald-300 border border-emerald-500/30"
                              }`}
                            >
                              {isSample ? "Built-in Sample" : "Uploaded Note"}
                            </span>
                            <span>•</span>
                            <span>{doc.chunkCount} chunks</span>
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {isSelected && (
                          <CheckCircle2 className="size-4 text-amber-400" />
                        )}
                        {!isSample && (
                          <button
                            type="button"
                            title="Remove document"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteDocument(doc.id, doc.title);
                            }}
                            className="p-1 hover:text-rose-400 text-stone-500 transition-colors"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* File Upload Results Feedback */}
          {uploadResults.length > 0 && (
            <div className="space-y-1.5 pt-2 border-t border-stone-800/60">
              <span className="text-[10px] uppercase font-bold tracking-wider text-stone-500">
                Upload Results:
              </span>
              <div className="grid gap-1.5">
                {uploadResults.map((res, i) => (
                  <div
                    key={i}
                    className={`rounded-lg p-2 text-xs flex items-center justify-between border ${
                      res.success
                        ? "bg-emerald-950/30 border-emerald-500/30 text-emerald-300"
                        : "bg-rose-950/30 border-rose-500/30 text-rose-300"
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      {res.success ? (
                        <CheckCircle2 className="size-3.5 text-emerald-400 shrink-0" />
                      ) : (
                        <AlertCircle className="size-3.5 text-rose-400 shrink-0" />
                      )}
                      <span className="font-semibold truncate">{res.fileName}</span>
                    </div>
                    <span className="text-[11px] shrink-0">
                      {res.success ? `Indexed (${res.chunkCount} chunks)` : res.error}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Step 2: Choose Learning Goal */}
        <div className="warm-glass-panel rounded-2xl p-5 shadow-xl space-y-4">
          <div className="flex items-center gap-2.5 border-b border-stone-800/80 pb-3">
            <span className="flex size-6 items-center justify-center rounded-md bg-amber-500/20 text-amber-400 font-bold text-xs">
              2
            </span>
            <h2 className="text-sm sm:text-base font-bold text-stone-100">
              Choose Learning Goal
            </h2>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setSelectedGoal("teach")}
              className={`p-3.5 rounded-xl border text-left transition-all ${
                selectedGoal === "teach"
                  ? "bg-amber-500/15 border-amber-500/50 shadow-sm"
                  : "bg-stone-900/60 border-stone-800/80 hover:border-stone-700"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-stone-100">
                  Teach me this material
                </span>
                {selectedGoal === "teach" && (
                  <CheckCircle2 className="size-3.5 text-amber-400" />
                )}
              </div>
              <p className="text-[11px] text-stone-400 mt-1">
                Conversational walkthrough of key concepts, formulas, and definitions with grounded check-ins.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setSelectedGoal("quiz")}
              className={`p-3.5 rounded-xl border text-left transition-all ${
                selectedGoal === "quiz"
                  ? "bg-amber-500/15 border-amber-500/50 shadow-sm"
                  : "bg-stone-900/60 border-stone-800/80 hover:border-stone-700"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-stone-100">
                  Quiz me on a topic
                </span>
                {selectedGoal === "quiz" && (
                  <CheckCircle2 className="size-3.5 text-amber-400" />
                )}
              </div>
              <p className="text-[11px] text-stone-400 mt-1">
                Test your knowledge with multiple-choice and short-answer questions verified against source notes.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setSelectedGoal("weak")}
              className={`p-3.5 rounded-xl border text-left transition-all ${
                selectedGoal === "weak"
                  ? "bg-amber-500/15 border-amber-500/50 shadow-sm"
                  : "bg-stone-900/60 border-stone-800/80 hover:border-stone-700"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-stone-100">
                  Revise my weak concepts
                </span>
                {selectedGoal === "weak" && (
                  <CheckCircle2 className="size-3.5 text-amber-400" />
                )}
              </div>
              <p className="text-[11px] text-stone-400 mt-1">
                Prioritizes open misconceptions and areas where your mastery score is lowest.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setSelectedGoal("full_document")}
              className={`p-3.5 rounded-xl border text-left transition-all ${
                selectedGoal === "full_document"
                  ? "bg-amber-500/15 border-amber-500/50 shadow-sm"
                  : "bg-stone-900/60 border-stone-800/80 hover:border-stone-700"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-stone-100">
                  Help me study the full document
                </span>
                {selectedGoal === "full_document" && (
                  <CheckCircle2 className="size-3.5 text-amber-400" />
                )}
              </div>
              <p className="text-[11px] text-stone-400 mt-1">
                Systematic section-by-section review covering the document from beginning to end.
              </p>
            </button>
          </div>

          {/* Step 3: Optional Topic Customization */}
          <div className="pt-2">
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor="topic-input"
                className="text-xs font-semibold text-stone-300 block"
              >
                Focus Topic (Optional):
              </label>
              {selectedDoc?.suggestedTopics && selectedDoc.suggestedTopics.length > 0 && (
                <span className="text-[10px] text-stone-500 font-mono">
                  {selectedDoc.suggestedTopics.length} topics detected
                </span>
              )}
            </div>

            {selectedDoc?.suggestedTopics && selectedDoc.suggestedTopics.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
                <span className="text-[10px] text-stone-500 uppercase font-bold mr-0.5">
                  Suggested:
                </span>
                {selectedDoc.suggestedTopics.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setCustomTopic(t.topic)}
                    className={`px-2 py-0.5 rounded text-[11px] border transition-colors ${
                      customTopic.trim().toLowerCase() === t.topic.toLowerCase()
                        ? "bg-amber-500/20 border-amber-500 text-amber-200 font-medium"
                        : "bg-stone-900 border-stone-800 text-stone-400 hover:text-stone-200 hover:border-stone-700"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}

            <input
              id="topic-input"
              type="text"
              value={customTopic}
              onChange={(e) => setCustomTopic(e.target.value)}
              placeholder={
                selectedDoc
                  ? `e.g. ${selectedDoc.suggestedTopics?.[0]?.topic || selectedDoc.title}, or leave blank for full document`
                  : "e.g. Core concepts or leave blank for full document"
              }
              className="w-full rounded-xl border border-stone-800 bg-stone-900/90 px-3.5 py-2 text-xs text-stone-100 placeholder-stone-500 focus:border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
            />
          </div>
        </div>

        {/* Start Learning Action Button */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
          <div className="flex items-center gap-2 text-xs text-emerald-400">
            <ShieldCheck className="size-4 text-emerald-400" />
            <span>
              Material Selected: <strong>{selectedDoc?.title || "Sample Notes"}</strong>
            </span>
          </div>

          <button
            type="button"
            onClick={handleStart}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 px-6 py-3 text-sm font-bold text-stone-950 shadow-lg shadow-amber-950/40 hover:opacity-95 transition-all"
          >
            <span>Start Learning</span>
            <ArrowRight className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
