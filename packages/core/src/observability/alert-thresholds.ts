export type AlertThresholdConfig = {
  version: string;
  error_rate_threshold_ratio: number;
  error_rate_window_minutes: number;
  crisis_intercept_spike_count: number;
  crisis_intercept_spike_window_minutes: number;
  llm_cost_hourly_usd_threshold: number;
  rpc_failure_count_threshold: number;
  rpc_failure_window_minutes: number;
};

const ALERT_THRESHOLD_CONFIG_VERSION = "2026-02-26.v1";

const DEFAULT_ALERT_THRESHOLDS: AlertThresholdConfig = {
  version: ALERT_THRESHOLD_CONFIG_VERSION,
  error_rate_threshold_ratio: 0.05,
  error_rate_window_minutes: 5,
  crisis_intercept_spike_count: 5,
  crisis_intercept_spike_window_minutes: 15,
  llm_cost_hourly_usd_threshold: 25,
  rpc_failure_count_threshold: 20,
  rpc_failure_window_minutes: 5,
};

export function getAlertThresholdConfig(): AlertThresholdConfig {
  return {
    version: ALERT_THRESHOLD_CONFIG_VERSION,
    error_rate_threshold_ratio: readFloatEnv(
      "METRICS_ALERT_ERROR_RATE_THRESHOLD_RATIO",
      DEFAULT_ALERT_THRESHOLDS.error_rate_threshold_ratio,
    ),
    error_rate_window_minutes: readIntEnv(
      "METRICS_ALERT_ERROR_RATE_WINDOW_MINUTES",
      DEFAULT_ALERT_THRESHOLDS.error_rate_window_minutes,
    ),
    crisis_intercept_spike_count: readIntEnv(
      "METRICS_ALERT_CRISIS_INTERCEPT_SPIKE_COUNT",
      DEFAULT_ALERT_THRESHOLDS.crisis_intercept_spike_count,
    ),
    crisis_intercept_spike_window_minutes: readIntEnv(
      "METRICS_ALERT_CRISIS_INTERCEPT_SPIKE_WINDOW_MINUTES",
      DEFAULT_ALERT_THRESHOLDS.crisis_intercept_spike_window_minutes,
    ),
    llm_cost_hourly_usd_threshold: readFloatEnv(
      "METRICS_ALERT_LLM_COST_HOURLY_USD",
      DEFAULT_ALERT_THRESHOLDS.llm_cost_hourly_usd_threshold,
    ),
    rpc_failure_count_threshold: readIntEnv(
      "METRICS_ALERT_RPC_FAILURE_COUNT",
      DEFAULT_ALERT_THRESHOLDS.rpc_failure_count_threshold,
    ),
    rpc_failure_window_minutes: readIntEnv(
      "METRICS_ALERT_RPC_FAILURE_WINDOW_MINUTES",
      DEFAULT_ALERT_THRESHOLDS.rpc_failure_window_minutes,
    ),
  };
}

function readEnv(name: string): string | null {
  const denoRuntime = (globalThis as unknown as {
    Deno?: { env?: { get?: (key: string) => string | undefined } };
  }).Deno;
  const denoValue = denoRuntime?.env?.get?.(name);
  if (typeof denoValue === "string" && denoValue.trim()) {
    return denoValue.trim();
  }

  const nodeRuntime = (globalThis as unknown as {
    process?: { env?: Record<string, string | undefined> };
  }).process;
  const nodeValue = nodeRuntime?.env?.[name];
  if (typeof nodeValue === "string" && nodeValue.trim()) {
    return nodeValue.trim();
  }

  return null;
}

function readFloatEnv(name: string, fallback: number): number {
  const raw = readEnv(name);
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function readIntEnv(name: string, fallback: number): number {
  const raw = readEnv(name);
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}
