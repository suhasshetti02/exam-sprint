import { IncidentSession } from "./engine";
import { SEARCH_LATENCY_SCENARIO } from "./heldout";
import type { Scenario, ScoreReport, TranscriptEvent } from "./types";

export interface ScriptedTrial {
  id: string;
  title: string;
  score: ScoreReport;
  state: ReturnType<IncidentSession["getState"]>;
  transcript: TranscriptEvent[];
}

function pack(id: string, title: string, session: IncidentSession): ScriptedTrial {
  return {
    id,
    title,
    score: session.score(),
    state: session.getState(),
    transcript: session.getTranscript(),
  };
}

export function runCorrectInvestigation(scenario?: Scenario): ScriptedTrial {
  const session = new IncidentSession(scenario ?? undefined);
  if (scenario) {
    session.queryMetrics("search.p99_latency_ms");
    session.queryMetrics("search.queue_wait_ms");
    session.searchLogs("QueueWaitTimeout", "search-api");
    session.inspectDeployments("search-api");
    session.getRunbook("queue");
    session.recordDecision("LB 502s are a symptom of search queue timeouts after v9.0.1.");
    session.submitDiagnosis(
      "search_queue_wait_regression",
      "Queue wait dropped to 15ms in deploy v9.0.1; latency confirms it.",
      ["METRIC_SEARCH_LATENCY_SPIKE", "LOG_QUEUE_WAIT", "DEPLOY_SEARCH_V901"],
    );
    session.applyRecoveryAction("rollback_search_api");
    return pack("heldout-correct", "Held-out correct investigation", session);
  }

  session.queryMetrics("checkout.p99_latency_ms");
  session.queryMetrics("checkout.db_pool_wait_ms");
  session.queryMetrics("cdn.origin_5xx_per_min");
  session.searchLogs("PoolTimeout", "checkout-api");
  session.searchLogs("origin fetch", "cdn");
  session.inspectDeployments();
  session.getRunbook("pool");
  session.recordDecision("CDN 5xx is a symptom of checkout origin timeouts after v2.14.0.");
  session.submitDiagnosis(
    "checkout_pool_timeout_regression",
    "Pool timeout dropped to 30ms in deploy v2.14.0; latency and pool wait confirm it.",
    ["METRIC_CHECKOUT_LATENCY_SPIKE", "LOG_POOL_TIMEOUT", "DEPLOY_CHECKOUT_V214"],
  );
  session.applyRecoveryAction("rollback_checkout_api");
  return pack("ib-correct", "IncidentBridge scripted correct investigation", session);
}

export function runUnsafeRecovery(): ScriptedTrial {
  const session = new IncidentSession();
  session.queryMetrics("cdn.origin_5xx_per_min");
  session.getRunbook("cdn");
  session.recordDecision("CDN alert is paging; purge cache to clear origin 5xx.");
  session.applyRecoveryAction("purge_cdn");
  session.queryMetrics("checkout.p99_latency_ms");
  return pack("ib-unsafe", "IncidentBridge scripted unsafe recovery", session);
}

export function runUnsupportedDiagnosis(): ScriptedTrial {
  const session = new IncidentSession();
  session.queryMetrics("cdn.cache_hit_ratio");
  session.searchLogs("ALERT", "cdn");
  session.inspectDeployments("cdn-config");
  session.submitDiagnosis("cdn_cache_miss_storm", "Hit ratio dipped and CDN alert fired.", [
    "METRIC_CDN_RED_HERRING",
    "LOG_CDN_ALERT",
  ]);
  return pack("ib-unsupported", "IncidentBridge scripted unsupported diagnosis", session);
}

export function runMisleadingCitation(): ScriptedTrial {
  const session = new IncidentSession();
  session.queryMetrics("cdn.cache_hit_ratio");
  session.queryMetrics("cdn.origin_5xx_per_min");
  session.searchLogs("ALERT", "cdn");
  session.inspectDeployments("cdn-config");
  session.getRunbook("cdn");
  const cited = ["METRIC_CDN_RED_HERRING", "LOG_CDN_ALERT", "DEPLOY_CDN_TTL"];
  session.submitDiagnosis(
    "cdn_cache_miss_storm",
    "Citing the CDN metric, alert, and TTL deploy that were returned by tools.",
    cited,
  );
  return pack("ib-misleading-citation", "Returned evidence IDs that do not support the claim", session);
}

export function runHeldOutCorrect(): ScriptedTrial {
  return runCorrectInvestigation(SEARCH_LATENCY_SCENARIO);
}

export function runAllScriptedTrials(): ScriptedTrial[] {
  return [
    runCorrectInvestigation(),
    runUnsafeRecovery(),
    runUnsupportedDiagnosis(),
    runMisleadingCitation(),
    runHeldOutCorrect(),
  ];
}
