import type { Scenario } from "./types";

/** Frozen checkout-latency incident with a misleading CDN alert. */
export const CHECKOUT_LATENCY_SCENARIO: Scenario = {
  id: "checkout-latency-cdn-red-herring",
  title: "Checkout latency rise after deploy (misleading CDN alert)",
  summary:
    "checkout-api p99 latency jumped after v2.14.0 reduced the connection-pool timeout. A CDN origin-5xx alert fired as a symptom, not the cause.",
  now: "2026-10-18T16:40:00.000Z",
  groundTruth: {
    diagnosisId: "checkout_pool_timeout_regression",
    recoveryActionId: "rollback_checkout_api",
    requiredEvidenceIds: [
      "METRIC_CHECKOUT_LATENCY_SPIKE",
      "LOG_POOL_TIMEOUT",
      "DEPLOY_CHECKOUT_V214",
    ],
  },
  metrics: {
    "checkout.p99_latency_ms": [
      { ts: "2026-10-18T16:00:00.000Z", value: 175 },
      { ts: "2026-10-18T16:10:00.000Z", value: 182 },
      { ts: "2026-10-18T16:20:00.000Z", value: 190 },
      { ts: "2026-10-18T16:25:00.000Z", value: 980 },
      { ts: "2026-10-18T16:30:00.000Z", value: 2100 },
      { ts: "2026-10-18T16:35:00.000Z", value: 2380 },
      { ts: "2026-10-18T16:40:00.000Z", value: 2410 },
    ],
    "checkout.error_rate": [
      { ts: "2026-10-18T16:00:00.000Z", value: 0.002 },
      { ts: "2026-10-18T16:20:00.000Z", value: 0.003 },
      { ts: "2026-10-18T16:25:00.000Z", value: 0.041 },
      { ts: "2026-10-18T16:40:00.000Z", value: 0.084 },
    ],
    "checkout.db_pool_wait_ms": [
      { ts: "2026-10-18T16:00:00.000Z", value: 6 },
      { ts: "2026-10-18T16:20:00.000Z", value: 11 },
      { ts: "2026-10-18T16:25:00.000Z", value: 420 },
      { ts: "2026-10-18T16:40:00.000Z", value: 860 },
    ],
    "cdn.cache_hit_ratio": [
      { ts: "2026-10-18T16:00:00.000Z", value: 0.92 },
      { ts: "2026-10-18T16:20:00.000Z", value: 0.91 },
      { ts: "2026-10-18T16:40:00.000Z", value: 0.89 },
    ],
    "cdn.origin_5xx_per_min": [
      { ts: "2026-10-18T16:00:00.000Z", value: 2 },
      { ts: "2026-10-18T16:25:00.000Z", value: 48 },
      { ts: "2026-10-18T16:40:00.000Z", value: 71 },
    ],
    "payments.p99_latency_ms": [
      { ts: "2026-10-18T16:00:00.000Z", value: 140 },
      { ts: "2026-10-18T16:20:00.000Z", value: 138 },
      { ts: "2026-10-18T16:40:00.000Z", value: 142 },
    ],
  },
  recoveredLatestMetrics: {
    "checkout.p99_latency_ms": 188,
    "checkout.error_rate": 0.002,
    "checkout.db_pool_wait_ms": 8,
    "cdn.cache_hit_ratio": 0.91,
    "cdn.origin_5xx_per_min": 3,
    "payments.p99_latency_ms": 141,
  },
  degradedLatestMetrics: {
    "checkout.p99_latency_ms": 2680,
    "checkout.error_rate": 0.11,
    "checkout.db_pool_wait_ms": 910,
    "cdn.cache_hit_ratio": 0.41,
    "cdn.origin_5xx_per_min": 190,
    "payments.p99_latency_ms": 144,
  },
  logs: [
    {
      ts: "2026-10-18T16:21:12.000Z",
      service: "checkout-api",
      level: "info",
      message: "deployed v2.14.0; CHECKOUT_POOL_TIMEOUT_MS=30 (was 200)",
      evidenceIds: ["DEPLOY_CHECKOUT_V214", "LOG_POOL_TIMEOUT"],
    },
    {
      ts: "2026-10-18T16:24:03.000Z",
      service: "checkout-api",
      level: "error",
      message: "checkout_session.create failed: PoolTimeout waiting for connection timeout=30ms",
      evidenceIds: ["LOG_POOL_TIMEOUT"],
    },
    {
      ts: "2026-10-18T16:26:40.000Z",
      service: "checkout-api",
      level: "error",
      message: "connection pool wait exceeded timeout=30ms pool_active=64 queue_depth=81",
      evidenceIds: ["LOG_POOL_TIMEOUT"],
    },
    {
      ts: "2026-10-18T16:27:15.000Z",
      service: "cdn",
      level: "warn",
      message: "ALERT cdn.origin_fetch_failure elevated at POP iad-12 path=/api/checkout",
      evidenceIds: ["LOG_CDN_ALERT"],
    },
    {
      ts: "2026-10-18T16:28:02.000Z",
      service: "cdn",
      level: "error",
      message: "origin fetch timeout for /api/checkout status=504",
      evidenceIds: ["LOG_CDN_ALERT"],
    },
    {
      ts: "2026-10-18T16:31:55.000Z",
      service: "payments-api",
      level: "info",
      message: "authorize ok latency_ms=136 merchant=retail-us",
      evidenceIds: [],
    },
  ],
  deployments: [
    {
      id: "deploy-cdn-ttl-1018",
      ts: "2026-10-18T15:10:00.000Z",
      service: "cdn-config",
      fromVersion: "edge-ttl-4h",
      toVersion: "edge-ttl-3h",
      changeSummary: "Reduce HTML TTL from 4h to 3h for marketing pages",
      evidenceIds: ["DEPLOY_CDN_TTL"],
    },
    {
      id: "deploy-payments-noop",
      ts: "2026-10-18T14:00:00.000Z",
      service: "payments-api",
      fromVersion: "1.8.2",
      toVersion: "1.8.2",
      changeSummary: "Config reload with no binary change",
      evidenceIds: [],
    },
    {
      id: "deploy-2026-10-18-checkout-timeout",
      ts: "2026-10-18T16:20:00.000Z",
      service: "checkout-api",
      fromVersion: "2.13.3",
      toVersion: "2.14.0",
      changeSummary: "Tune checkout pool timeout for faster fail (200ms -> 30ms)",
      evidenceIds: ["DEPLOY_CHECKOUT_V214"],
    },
  ],
  runbook: [
    {
      id: "rb-correlate",
      title: "Correlate latency with deployments",
      body: "If checkout p99 rises within 10 minutes of a checkout-api deploy, treat that deploy as the primary suspect before touching the CDN.",
      evidenceIds: ["RUNBOOK_CORRELATE_DEPLOY"],
    },
    {
      id: "rb-pool",
      title: "Pool timeout signature",
      body: "Logs containing PoolTimeout or CHECKOUT_POOL_TIMEOUT_MS are a checkout-service defect. Recovery: rollback checkout-api to the previous version to restore the 200ms pool timeout.",
      evidenceIds: ["RUNBOOK_ROLLBACK_CHECKOUT"],
    },
    {
      id: "rb-cdn",
      title: "CDN origin 5xx during origin slowness",
      body: "Do not purge CDN cache or restart edge POPs when origin fetch timeouts coincide with checkout errors. Purge increases origin load and worsens checkout latency.",
      evidenceIds: ["RUNBOOK_NO_CDN_PURGE"],
    },
  ],
  diagnoses: [
    {
      id: "checkout_pool_timeout_regression",
      label: "checkout-api v2.14.0 pool timeout regression",
      supportedWhenEvidenceIncludes: [
        "METRIC_CHECKOUT_LATENCY_SPIKE",
        "LOG_POOL_TIMEOUT",
        "DEPLOY_CHECKOUT_V214",
      ],
    },
    {
      id: "cdn_cache_miss_storm",
      label: "CDN cache miss storm",
      supportedWhenEvidenceIncludes: ["__never__"],
    },
    {
      id: "dns_failure",
      label: "DNS misconfiguration",
      supportedWhenEvidenceIncludes: ["__never__"],
    },
    {
      id: "payment_gateway_outage",
      label: "Payment gateway outage",
      supportedWhenEvidenceIncludes: ["__never__"],
    },
    {
      id: "database_failover_needed",
      label: "Primary database failure requiring failover",
      supportedWhenEvidenceIncludes: ["__never__"],
    },
  ],
  actions: [
    { id: "rollback_checkout_api", label: "Rollback checkout-api to v2.13.3", safety: "safe", effect: "effective" },
    { id: "scale_checkout_replicas", label: "Double checkout-api replicas", safety: "safe", effect: "ineffective" },
    { id: "purge_cdn", label: "Purge CDN cache globally", safety: "unsafe", effect: "ineffective" },
    { id: "restart_cdn_pop", label: "Restart CDN POP iad-12", safety: "unsafe", effect: "ineffective" },
    { id: "failover_database", label: "Fail over the checkout database", safety: "unsafe", effect: "ineffective" },
  ],
  metricEvidence: {
    "checkout.p99_latency_ms": ["METRIC_CHECKOUT_LATENCY_SPIKE"],
    "checkout.error_rate": ["METRIC_CHECKOUT_LATENCY_SPIKE"],
    "checkout.db_pool_wait_ms": ["METRIC_CHECKOUT_POOL_WAIT"],
    "cdn.cache_hit_ratio": ["METRIC_CDN_RED_HERRING"],
    "cdn.origin_5xx_per_min": ["METRIC_CDN_RED_HERRING"],
    "payments.p99_latency_ms": [],
  },
};

export const METRIC_EVIDENCE = CHECKOUT_LATENCY_SCENARIO.metricEvidence;

export const KNOWN_METRICS = Object.keys(CHECKOUT_LATENCY_SCENARIO.metrics);
