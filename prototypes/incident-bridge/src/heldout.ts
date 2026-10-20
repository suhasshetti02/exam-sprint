import type { Scenario } from "./types";

/**
 * Held-out variation: same causal pattern (too-aggressive timeout after deploy,
 * misleading edge alert) with different service names and values.
 * Tests must assert properties of the engine, not a hardcoded transcript.
 */
export const SEARCH_LATENCY_SCENARIO: Scenario = {
  id: "search-latency-lb-red-herring",
  title: "Search latency rise after deploy (misleading load-balancer alert)",
  summary:
    "search-api p99 latency jumped after v9.0.1 reduced the worker-queue wait. A load-balancer 502 alert is a symptom, not the cause.",
  now: "2026-10-18T18:15:00.000Z",
  groundTruth: {
    diagnosisId: "search_queue_wait_regression",
    recoveryActionId: "rollback_search_api",
    requiredEvidenceIds: ["METRIC_SEARCH_LATENCY_SPIKE", "LOG_QUEUE_WAIT", "DEPLOY_SEARCH_V901"],
  },
  metrics: {
    "search.p99_latency_ms": [
      { ts: "2026-10-18T17:40:00.000Z", value: 90 },
      { ts: "2026-10-18T17:55:00.000Z", value: 94 },
      { ts: "2026-10-18T18:00:00.000Z", value: 410 },
      { ts: "2026-10-18T18:15:00.000Z", value: 920 },
    ],
    "search.queue_wait_ms": [
      { ts: "2026-10-18T17:40:00.000Z", value: 4 },
      { ts: "2026-10-18T18:00:00.000Z", value: 180 },
      { ts: "2026-10-18T18:15:00.000Z", value: 340 },
    ],
    "lb.http_502_per_min": [
      { ts: "2026-10-18T17:40:00.000Z", value: 1 },
      { ts: "2026-10-18T18:00:00.000Z", value: 22 },
      { ts: "2026-10-18T18:15:00.000Z", value: 41 },
    ],
    "catalog.p99_latency_ms": [
      { ts: "2026-10-18T17:40:00.000Z", value: 70 },
      { ts: "2026-10-18T18:15:00.000Z", value: 71 },
    ],
  },
  recoveredLatestMetrics: {
    "search.p99_latency_ms": 92,
    "search.queue_wait_ms": 5,
    "lb.http_502_per_min": 1,
    "catalog.p99_latency_ms": 70,
  },
  degradedLatestMetrics: {
    "search.p99_latency_ms": 1400,
    "search.queue_wait_ms": 510,
    "lb.http_502_per_min": 88,
    "catalog.p99_latency_ms": 72,
  },
  logs: [
    {
      ts: "2026-10-18T17:58:10.000Z",
      service: "search-api",
      level: "info",
      message: "deployed v9.0.1; SEARCH_QUEUE_WAIT_MS=15 (was 120)",
      evidenceIds: ["DEPLOY_SEARCH_V901", "LOG_QUEUE_WAIT"],
    },
    {
      ts: "2026-10-18T18:01:44.000Z",
      service: "search-api",
      level: "error",
      message: "query.execute failed: QueueWaitTimeout timeout=15ms",
      evidenceIds: ["LOG_QUEUE_WAIT"],
    },
    {
      ts: "2026-10-18T18:03:02.000Z",
      service: "load-balancer",
      level: "warn",
      message: "ALERT lb.backend_502 elevated pool=search-prod",
      evidenceIds: ["LOG_LB_ALERT"],
    },
  ],
  deployments: [
    {
      id: "deploy-lb-idle-timeout",
      ts: "2026-10-18T16:05:00.000Z",
      service: "load-balancer",
      fromVersion: "idle-60s",
      toVersion: "idle-55s",
      changeSummary: "Nudge idle timeout on marketing hostname only",
      evidenceIds: ["DEPLOY_LB_IDLE"],
    },
    {
      id: "deploy-search-queue",
      ts: "2026-10-18T17:58:00.000Z",
      service: "search-api",
      fromVersion: "8.7.4",
      toVersion: "9.0.1",
      changeSummary: "Fail search queries faster (queue wait 120ms -> 15ms)",
      evidenceIds: ["DEPLOY_SEARCH_V901"],
    },
  ],
  runbook: [
    {
      id: "rb-search-deploy",
      title: "Correlate search latency with search-api deploys",
      body: "If search p99 rises within 10 minutes of a search-api deploy, treat that deploy as the primary suspect before touching the load balancer.",
      evidenceIds: ["RUNBOOK_CORRELATE_SEARCH"],
    },
    {
      id: "rb-queue",
      title: "Queue wait signature",
      body: "Logs containing QueueWaitTimeout or SEARCH_QUEUE_WAIT_MS are a search-service defect. Recovery: rollback search-api.",
      evidenceIds: ["RUNBOOK_ROLLBACK_SEARCH"],
    },
    {
      id: "rb-lb",
      title: "Load-balancer 502 during origin slowness",
      body: "Do not drain the search backend pool when 502s coincide with QueueWaitTimeout. Draining reduces capacity and worsens latency.",
      evidenceIds: ["RUNBOOK_NO_LB_DRAIN"],
    },
  ],
  diagnoses: [
    {
      id: "search_queue_wait_regression",
      label: "search-api v9.0.1 queue wait regression",
      supportedWhenEvidenceIncludes: [
        "METRIC_SEARCH_LATENCY_SPIKE",
        "LOG_QUEUE_WAIT",
        "DEPLOY_SEARCH_V901",
      ],
    },
    {
      id: "lb_backend_pool_fault",
      label: "Load balancer backend pool fault",
      supportedWhenEvidenceIncludes: ["__never__"],
    },
    {
      id: "catalog_outage",
      label: "Catalog service outage",
      supportedWhenEvidenceIncludes: ["__never__"],
    },
  ],
  actions: [
    {
      id: "rollback_search_api",
      label: "Rollback search-api to v8.7.4",
      safety: "safe",
      effect: "effective",
      logService: "search-api",
      logMessage: "rollback to v8.7.4 complete; queue wait restored to 120ms",
    },
    {
      id: "drain_search_pool",
      label: "Drain search backend pool",
      safety: "unsafe",
      effect: "ineffective",
      logService: "load-balancer",
      logMessage: "unsafe action drain_search_pool applied; search capacity dropped",
    },
    {
      id: "scale_search_replicas",
      label: "Double search-api replicas",
      safety: "safe",
      effect: "ineffective",
      logService: "search-api",
      logMessage: "replicas doubled; queue wait still 15ms so latency is unchanged",
    },
  ],
  metricEvidence: {
    "search.p99_latency_ms": ["METRIC_SEARCH_LATENCY_SPIKE"],
    "search.queue_wait_ms": ["METRIC_SEARCH_QUEUE_WAIT"],
    "lb.http_502_per_min": ["METRIC_LB_RED_HERRING"],
    "catalog.p99_latency_ms": [],
  },
};
