import { CheckCircle2, Circle } from "lucide-react";
import { Panel } from "./Panel";

export const IMPLEMENTATION_STATUS = [
  { label: "Monorepo, shared schemas, strict TypeScript", done: true },
  { label: "MCP server over Streamable HTTP with tool discovery", done: true },
  { label: "Web ↔ MCP handshake (this page)", done: true },
  { label: "SQLite schema and migration runner", done: true },
  { label: "Note retrieval and evidence verification", done: true },
  { label: "Quiz generation and answer evaluation", done: true },
  { label: "Progress and mastery persistence", done: true },
  { label: "LLM agent loop and deterministic fallback", done: true },
  { label: "Rapid-Fire Redemption weak-concept sprint", done: true },
  { label: "Voice input/output (Web Speech API)", done: false },
] as const;

export function StatusChecklist() {
  return (
    <Panel title="Build status">
      <ul className="space-y-1.5 text-xs">
        {IMPLEMENTATION_STATUS.map((item) => (
          <li key={item.label} className="flex items-center gap-2 text-stone-300">
            <span aria-hidden="true" className={item.done ? "text-emerald-400" : "text-stone-500"}>
              {item.done ? <CheckCircle2 className="size-3.5" /> : <Circle className="size-3.5" />}
            </span>
            <span>
              {item.label}
              <span className="sr-only">{item.done ? " (done)" : " (not built yet)"}</span>
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
