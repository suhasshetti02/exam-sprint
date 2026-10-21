"use client";

import { useEffect, useState } from "react";
import { Terminal, Activity, ChevronDown, ChevronRight, CheckCircle2, AlertCircle } from "lucide-react";
import {
  fetchServerStatus,
  type ServerStatus as Status,
  type ToolTraceEntry,
} from "@/lib/api-client";
import { Panel } from "./Panel";

type ViewState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "done"; status: Status };

interface ServerStatusProps {
  toolTraces?: ToolTraceEntry[];
  lastResponseEngine?: "llm" | "deterministic_fallback";
}

export function ServerStatus({ toolTraces = [], lastResponseEngine }: ServerStatusProps) {
  const [state, setState] = useState<ViewState>({ phase: "loading" });
  const [expandedTraceIdx, setExpandedTraceIdx] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchServerStatus(controller.signal)
      .then((status) => setState({ phase: "done", status }))
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          phase: "error",
          message: e instanceof Error ? e.message : "Request failed.",
        });
      });
    return () => controller.abort();
  }, []);

  const toggleTrace = (idx: number) => {
    setExpandedTraceIdx((prev) => (prev === idx ? null : idx));
  };

  return (
    <Panel
      title="MCP Server & Tool Trace"
      badge={
        state.phase === "done" && state.status.reachable
          ? "Streamable HTTP"
          : undefined
      }
      icon={<Terminal className="size-4 text-amber-400" />}
    >
      {state.phase === "loading" && (
        <div className="py-4 text-center text-xs text-amber-300/80">
          <p className="animate-pulse">Checking MCP server connection…</p>
        </div>
      )}

      {state.phase === "error" && (
        <p role="alert" className="text-xs text-rose-400 font-medium bg-rose-500/10 border border-rose-500/20 rounded-xl p-2.5">
          Could not check the MCP server: {state.message}
        </p>
      )}

      {state.phase === "done" && !state.status.reachable && (
        <p role="alert" className="text-xs text-rose-400 font-medium bg-rose-500/10 border border-rose-500/20 rounded-xl p-2.5">
          {state.status.reason}
        </p>
      )}

      {state.phase === "done" && state.status.reachable && (
        <div className="space-y-3">
          {/* Server Handshake Header */}
          <div className="rounded-xl border border-stone-800/80 bg-[#0e0c0a] p-2.5 text-xs space-y-2">
            <div className="flex items-center justify-between text-xs pb-1.5 border-b border-stone-800/70">
              <span className="text-stone-400 font-medium flex items-center gap-1.5">
                <Activity className="size-3 text-amber-400" />
                <span>LLM Provider:</span>
              </span>
              <span
                className={`font-semibold flex items-center gap-1 ${
                  state.status.provider?.configured ? "text-amber-400" : "text-stone-400"
                }`}
              >
                <span
                  className={`size-1.5 rounded-full ${
                    state.status.provider?.configured ? "bg-amber-400" : "bg-stone-500"
                  }`}
                />
                {state.status.provider?.configured
                  ? `Configured (${state.status.provider.model || "Gemini"})`
                  : "Not Configured (Offline Fallback)"}
              </span>
            </div>

            {lastResponseEngine && (
              <div className="flex items-center justify-between text-[11px] pb-1 border-b border-stone-800/60 text-stone-400">
                <span>Active Response Engine:</span>
                <span className="font-mono text-stone-200 font-semibold">
                  {lastResponseEngine === "llm" ? "Live AI (Agent Loop)" : "Deterministic Policy"}
                </span>
              </div>
            )}

            <p className="text-[11px] text-emerald-400 font-medium">
              Connected to {state.status.serverName} v{state.status.serverVersion} ·{" "}
              {state.status.tools.length} tools discovered.
            </p>

            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-[11px] pt-0.5">
              {state.status.tools.map((t) => (
                <li
                  key={t.name}
                  className="flex justify-between items-center py-1 px-2 rounded-lg bg-stone-900/80 border border-stone-800/70"
                >
                  <code className="text-amber-300 font-mono text-[10px]">{t.name}</code>
                  <span className="text-[10px] text-emerald-400 font-medium">
                    {t.status === "implemented" ? "Implemented" : "Contract only"}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Live Tool Call Trace */}
          <div className="border-t border-stone-800/80 pt-2.5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[11px] font-bold text-stone-200 uppercase tracking-wider flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-amber-400 animate-ping" />
                <span>Live Tool Execution Trace</span>
              </h3>
              <span className="text-[10px] font-mono text-stone-400 bg-stone-900/80 border border-stone-800 px-1.5 py-0.5 rounded-md">
                {toolTraces.length} {toolTraces.length === 1 ? "call" : "calls"}
              </span>
            </div>

            {toolTraces.length === 0 ? (
              <p className="text-xs text-stone-500 italic p-3 rounded-xl border border-dashed border-stone-800 bg-[#090807]">
                No tool calls yet. Request a topic or submit an answer to see real MCP tool invocations.
              </p>
            ) : (
              <div className="max-h-[180px] overflow-y-auto space-y-1.5 pr-1">
                {toolTraces.map((trace, idx) => {
                  const isExpanded = expandedTraceIdx === idx;
                  const isSuccess = trace.status === "success";

                  return (
                    <div
                      key={`${trace.timestamp}-${idx}`}
                      className="rounded-xl border border-stone-800/80 bg-[#090807] p-2 text-xs transition-colors hover:border-amber-500/30"
                    >
                      <button
                        type="button"
                        onClick={() => toggleTrace(idx)}
                        className="w-full flex items-center justify-between text-left gap-2 cursor-pointer"
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          {isExpanded ? (
                            <ChevronDown className="size-3 text-stone-400 shrink-0" />
                          ) : (
                            <ChevronRight className="size-3 text-stone-400 shrink-0" />
                          )}
                          <span className="font-mono text-xs font-bold text-amber-300 truncate">
                            {trace.tool}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] shrink-0">
                          <span
                            className={`font-semibold px-1.5 py-0.2 rounded flex items-center gap-1 ${
                              isSuccess
                                ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                                : "bg-rose-500/15 text-rose-300 border border-rose-500/30"
                            }`}
                          >
                            {isSuccess ? (
                              <CheckCircle2 className="size-2.5" />
                            ) : (
                              <AlertCircle className="size-2.5" />
                            )}
                            <span>{trace.status}</span>
                          </span>
                          <span className="font-mono text-stone-400">{trace.durationMs}ms</span>
                        </div>
                      </button>

                      {/* Arguments Preview */}
                      {trace.arguments && Object.keys(trace.arguments).length > 0 && !isExpanded && (
                        <p className="text-[10px] text-stone-400 font-mono truncate mt-1 pl-4">
                          args: {JSON.stringify(trace.arguments)}
                        </p>
                      )}

                      {/* Expandable JSON Inspector */}
                      {isExpanded && (
                        <div className="mt-2 pt-2 border-t border-stone-800/80 pl-4 space-y-1 font-mono text-[10px]">
                          <div>
                            <span className="text-stone-400 block text-[9px] uppercase">Arguments:</span>
                            <pre className="bg-stone-950 p-1.5 rounded-lg border border-stone-800 text-amber-200 overflow-x-auto">
                              {JSON.stringify(trace.arguments, null, 2)}
                            </pre>
                          </div>
                          {trace.error && (
                            <div className="text-rose-400">
                              <span className="text-[9px] uppercase block">Error:</span>
                              <pre className="bg-rose-950/40 p-1.5 rounded-lg border border-rose-500/30 text-rose-200">
                                {trace.error}
                              </pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}
