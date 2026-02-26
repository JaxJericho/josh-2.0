# Alert Thresholds Runbook — Ticket 13.3

Canonical threshold definitions are implemented in:

- `packages/core/src/observability/alert-thresholds.ts`

Config version:

- `2026-02-26.v1`

Thresholds (default values):

- Error rate threshold: `error_rate_threshold_ratio=0.05` over `5` minutes
- Crisis intercept spike threshold: `crisis_intercept_spike_count=5` over `15` minutes
- LLM cost per hour threshold: `llm_cost_hourly_usd_threshold=25`
- RPC failure threshold: `rpc_failure_count_threshold=20` over `5` minutes

Optional environment overrides (names only):

- `METRICS_ALERT_ERROR_RATE_THRESHOLD_RATIO`
- `METRICS_ALERT_ERROR_RATE_WINDOW_MINUTES`
- `METRICS_ALERT_CRISIS_INTERCEPT_SPIKE_COUNT`
- `METRICS_ALERT_CRISIS_INTERCEPT_SPIKE_WINDOW_MINUTES`
- `METRICS_ALERT_LLM_COST_HOURLY_USD`
- `METRICS_ALERT_RPC_FAILURE_COUNT`
- `METRICS_ALERT_RPC_FAILURE_WINDOW_MINUTES`

No external alerting integration is required for this ticket. These thresholds are codified for deterministic runtime policy and downstream wiring.
