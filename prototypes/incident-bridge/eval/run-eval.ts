import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { listTools } from "../src/tools";
import { runAllScriptedTrials } from "../src/scripted-trials";
import { initialIncidentBriefing } from "./briefing";
import {
  PAIRED_TRIALS,
  runBaselineLlmTrial,
  runIncidentBridgeMcpTrial,
  type ConditionRecord,
} from "./agents";
import { LlmInfrastructureError, loadLlmConfig } from "./llm";
import { runScriptedPagerBaselines } from "./scripted-baseline";

const here = dirname(fileURLToPath(import.meta.url));

function gitHash(): string | null {
  const candidates = [resolve(here, ".."), resolve(here, "../../..")];
  for (const cwd of candidates) {
    try {
      const top = execSync("git rev-parse --show-toplevel", {
        cwd,
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim()
        .replace(/\\/g, "/")
        .toLowerCase();
      if (!top.endsWith("/exam-sprint") && !top.endsWith("/incident-bridge")) continue;
      return execSync("git rev-parse HEAD", { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch {
      // try next
    }
  }
  return null;
}

function summarizeScore(record: ConditionRecord | null) {
  if (!record?.score) return { status: record ? "unscored" : "missing", score: null };
  return {
    status: "scored",
    score: record.score.score,
    investigationOutcome: record.score.investigationOutcome,
    luckyRecoveryGuess: record.score.luckyRecoveryGuess,
    diagnosisId: record.score.diagnosisId,
    recoveryActionId: record.score.recoveryActionId,
    diagnosisSupportedByEvidence: record.score.diagnosisSupportedByEvidence,
    recoverySupportedByEvidence: record.score.recoverySupportedByEvidence,
    recoveryActionMatchedGroundTruth: record.score.recoveryActionMatchedGroundTruth,
    unsafeRecoveryAttempted: record.score.unsafeRecoveryAttempted,
    citedEvidenceSupportsClaim: record.score.citedEvidenceSupportsClaim,
    returnedButNonSupportingCitedIds: record.score.returnedButNonSupportingCitedIds,
    citedButNotReturnedIds: record.score.citedButNotReturnedIds,
    toolCallCount: record.toolCalls.length,
    mcpTransport: record.mcp?.transport ?? null,
  };
}

function classifyLiveError(error: unknown): { class: "infrastructure" | "runner"; message: string } {
  if (error instanceof LlmInfrastructureError) {
    return { class: "infrastructure", message: error.message };
  }
  return { class: "runner", message: error instanceof Error ? error.message : "error" };
}

async function main() {
  const scripted = runAllScriptedTrials();
  const config = loadLlmConfig();
  const live: ConditionRecord[] = [];
  const liveErrors: { condition: string; trial: string; class: "infrastructure" | "runner"; message: string }[] = [];

  if (config.present) {
    for (const trial of PAIRED_TRIALS) {
      try {
        live.push(await runIncidentBridgeMcpTrial(config, trial));
      } catch (error) {
        const classified = classifyLiveError(error);
        liveErrors.push({ condition: "incident_bridge_mcp", trial, ...classified });
      }
      try {
        live.push(await runBaselineLlmTrial(config, trial));
      } catch (error) {
        const classified = classifyLiveError(error);
        liveErrors.push({ condition: "llm_roleplay_baseline", trial, ...classified });
      }
    }
  }

  const scriptedBaselines = runScriptedPagerBaselines();
  const infrastructureOnly = liveErrors.length > 0 && liveErrors.every((e) => e.class === "infrastructure");
  const report = {
    generatedAt: new Date().toISOString(),
    gitHash: gitHash(),
    resultClasses: {
      deterministicUnitAndScripted:
        "IncidentBridge engine trials and scripted pager-only policies. Repeatable. Not live LLM.",
      scriptedPagerBaselines:
        "Deterministic no-tools stand-ins with the same briefing and the same external rubric. Not a measured LLM failure.",
      liveLlm: (() => {
        const completePairs = PAIRED_TRIALS.filter(
          (trial) =>
            live.some((r) => r.condition === "incident_bridge_mcp" && r.trial === trial) &&
            live.some((r) => r.condition === "llm_roleplay_baseline" && r.trial === trial),
        );
        if (completePairs.length === PAIRED_TRIALS.length) {
          return `MEASURED: same model (${config.model}); IncidentBridge used Streamable HTTP MCP client/server; baseline had no tools.`;
        }
        if (live.length) {
          return `INCOMPLETE: same model (${config.model}); ${live.length} unpaired completion(s), ${completePairs.length} complete pair(s). Missing pairs are not scored as model failures. See liveLlm.errors.`;
        }
        if (!config.present) {
          return "SKIPPED: no LLM credentials loaded. The live LLM baseline is not marked failed.";
        }
        if (infrastructureOnly) {
          return `INFRASTRUCTURE: same model (${config.model}) was configured, but the API/adapter did not complete paired trials. Not a model investigation failure.`;
        }
        return `ATTEMPTED same model (${config.model}); no completed trials. See liveLlm.errors.`;
      })(),
    },
    mcpTools: listTools(),
    equivalentInitialBriefing: initialIncidentBriefing(),
    pairedProtocol: {
      trials: PAIRED_TRIALS,
      incidentBridgeTransport: "mcp streamable-http client -> local /mcp server",
      baselineTransport: "none (role-play JSON only)",
      rubric: "src/rubric.ts scoreInvestigation used for both conditions",
    },
    scriptedIncidentBridge: scripted.map((trial) => ({
      id: trial.id,
      title: trial.title,
      score: trial.score.score,
      investigationOutcome: trial.score.investigationOutcome,
      luckyRecoveryGuess: trial.score.luckyRecoveryGuess,
      diagnosisId: trial.score.diagnosisId,
      recoveryActionId: trial.score.recoveryActionId,
      diagnosisSupportedByEvidence: trial.score.diagnosisSupportedByEvidence,
      recoverySupportedByEvidence: trial.score.recoverySupportedByEvidence,
      recoveryActionMatchedGroundTruth: trial.score.recoveryActionMatchedGroundTruth,
      unsafeRecoveryAttempted: trial.score.unsafeRecoveryAttempted,
      citedEvidenceSupportsClaim: trial.score.citedEvidenceSupportsClaim,
      returnedButNonSupportingCitedIds: trial.score.returnedButNonSupportingCitedIds,
      citedButNotReturnedIds: trial.score.citedButNotReturnedIds,
      observedEvidenceIds: trial.score.observedEvidenceIds,
      transcriptKinds: trial.transcript.map((e) => `${e.kind}:${e.name}`),
    })),
    scriptedPagerBaselines: scriptedBaselines.map((row) => ({
      policy: row.policy,
      trial: row.trial,
      output: row.output,
      score: row.score.score,
      investigationOutcome: row.score.investigationOutcome,
      luckyRecoveryGuess: row.score.luckyRecoveryGuess,
      diagnosisSupportedByEvidence: row.score.diagnosisSupportedByEvidence,
      recoverySupportedByEvidence: row.score.recoverySupportedByEvidence,
      recoveryActionMatchedGroundTruth: row.score.recoveryActionMatchedGroundTruth,
      unsafeRecoveryAttempted: row.score.unsafeRecoveryAttempted,
      citedEvidenceSupportsClaim: row.score.citedEvidenceSupportsClaim,
      citedButNotReturnedIds: row.score.citedButNotReturnedIds,
      returnedButNonSupportingCitedIds: row.score.returnedButNonSupportingCitedIds,
    })),
    liveLlm: {
      attempted: config.present,
      model: config.present ? config.model : null,
      errors: liveErrors,
      trials: live.map((record) => ({
        condition: record.condition,
        trial: record.trial,
        summary: summarizeScore(record),
        notes: record.notes,
        parsedFinal: record.parsedFinal,
        inputs: record.inputs,
        mcp: record.mcp ?? null,
        toolCalls: record.toolCalls,
        rawOutputs: record.rawOutputs,
      })),
    },
  };

  const outDir = resolve(here, "results");
  mkdirSync(outDir, { recursive: true });
  const outFile = resolve(outDir, "last-run.json");
  writeFileSync(outFile, JSON.stringify(report, null, 2), "utf8");
  process.stdout.write(`Wrote ${outFile}\n`);
  process.stdout.write(
    `${JSON.stringify(
      {
        gitHash: report.gitHash,
        liveAttempted: config.present,
        liveModel: config.present ? config.model : null,
        liveErrors,
        scriptedIncidentBridge: report.scriptedIncidentBridge,
        scriptedPagerBaselines: report.scriptedPagerBaselines,
      },
      null,
      2,
    )}\n`,
  );
}

await main();
