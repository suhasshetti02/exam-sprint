import { IncidentSession } from "./engine";
import { invokeTool, listTools, resetSession } from "./tools";

function heading(title: string) {
  process.stdout.write(`\n=== ${title} ===\n`);
}

function dump(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

heading("MCP tools");
dump(listTools());

heading("Example tool outputs (fresh session)");
resetSession("demo-tools");
dump(invokeTool("query_metrics", { sessionId: "demo-tools", metric: "checkout.p99_latency_ms" }));
dump(invokeTool("search_logs", { sessionId: "demo-tools", query: "PoolTimeout" }));
dump(invokeTool("inspect_deployments", { sessionId: "demo-tools", service: "checkout-api" }));
dump(invokeTool("get_runbook", { sessionId: "demo-tools", topic: "cdn" }));

heading("Correct investigation");
const correct = new IncidentSession();
correct.queryMetrics("checkout.p99_latency_ms");
correct.queryMetrics("checkout.db_pool_wait_ms");
correct.queryMetrics("cdn.origin_5xx_per_min");
correct.searchLogs("PoolTimeout", "checkout-api");
correct.searchLogs("origin fetch", "cdn");
correct.inspectDeployments();
correct.getRunbook("pool");
correct.recordDecision("CDN 5xx is a symptom of checkout origin timeouts after v2.14.0.");
correct.submitDiagnosis(
  "checkout_pool_timeout_regression",
  "Pool timeout dropped to 30ms in deploy v2.14.0; latency and pool wait confirm it.",
);
dump(correct.applyRecoveryAction("rollback_checkout_api"));
dump(correct.score());

heading("Unsafe recovery attempt");
const unsafe = new IncidentSession();
unsafe.queryMetrics("cdn.origin_5xx_per_min");
unsafe.getRunbook("cdn");
unsafe.recordDecision("CDN alert is paging; purge cache to clear origin 5xx.");
dump(unsafe.applyRecoveryAction("purge_cdn"));
dump(unsafe.queryMetrics("checkout.p99_latency_ms"));
dump(unsafe.score());

heading("Unsupported diagnosis");
const unsupported = new IncidentSession();
unsupported.queryMetrics("cdn.cache_hit_ratio");
unsupported.searchLogs("ALERT", "cdn");
unsupported.inspectDeployments("cdn-config");
unsupported.submitDiagnosis("cdn_cache_miss_storm", "Hit ratio dipped and CDN alert fired.");
dump(unsupported.score());
