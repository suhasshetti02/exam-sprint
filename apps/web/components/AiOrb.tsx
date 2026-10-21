"use client";

import { Sparkles, Volume2 } from "lucide-react";

interface AiOrbProps {
  isLoading?: boolean;
  statusText?: string;
  providerType?: "llm" | "deterministic_fallback";
  modelName?: string;
  voiceStatusText?: string;
}

export function AiOrb({
  isLoading = false,
  statusText,
  providerType = "llm",
  modelName = "Gemini",
  voiceStatusText,
}: AiOrbProps) {
  const isAiLive = providerType === "llm";

  return (
    <div className="flex items-center gap-4 py-2 px-1">
      {/* Orb Visual */}
      <div className="relative flex items-center justify-center size-14 sm:size-16 shrink-0">
        {/* Outer ambient glow */}
        <div
          className={`absolute inset-0 rounded-full blur-xl transition-opacity duration-700 ${
            isLoading
              ? "bg-amber-500/40 opacity-100 animate-pulse"
              : "bg-amber-500/20 opacity-70"
          }`}
        />

        {/* Outer Rotating / Breathing Ring */}
        <div
          className={`size-12 sm:size-14 rounded-full border border-amber-400/30 flex items-center justify-center transition-all ${
            isLoading ? "orb-thinking" : "orb-idle"
          }`}
          style={{
            background:
              "radial-gradient(circle at 35% 35%, rgba(245, 158, 11, 0.35) 0%, rgba(234, 88, 12, 0.22) 50%, rgba(12, 10, 9, 0.95) 100%)",
          }}
        >
          {/* Inner Core */}
          <div
            className={`size-6 sm:size-7 rounded-full flex items-center justify-center transition-all duration-500 ${
              isLoading
                ? "bg-gradient-to-br from-amber-400 via-orange-500 to-rose-600 shadow-lg shadow-amber-500/50 scale-110"
                : "bg-gradient-to-br from-amber-400 via-orange-500 to-rose-600 shadow-md shadow-amber-500/30"
            }`}
          >
            <Sparkles className="size-3.5 text-stone-950/90" />
          </div>
        </div>
      </div>

      {/* Identity & Status Details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-xs sm:text-sm text-stone-100 tracking-tight flex items-center gap-1.5">
            Alexa+ AI Tutor
          </span>
          <span
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
              isAiLive
                ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                : "bg-stone-900/80 text-stone-300 border border-stone-800"
            }`}
          >
            <span
              className={`size-1.5 rounded-full ${isAiLive ? "bg-amber-400 animate-ping" : "bg-stone-500"}`}
            />
            {isAiLive ? modelName : "Deterministic Engine"}
          </span>
        </div>

        <p className="text-[11px] text-stone-400 truncate mt-0.5">
          {isLoading
            ? statusText || "Synthesizing note evidence & response…"
            : "Conversational exam revision grounded in verified notes"}
        </p>

        {/* Real Active Voice & Spoken capability indicator */}
        <div className="flex items-center gap-1.5 text-[10px] text-stone-400 mt-1">
          <Volume2 className="size-3 text-amber-400 shrink-0" />
          <span className="truncate">
            {voiceStatusText || "Voice tutor active · Spoken answers, audio output & commands"}
          </span>
        </div>
      </div>
    </div>
  );
}
