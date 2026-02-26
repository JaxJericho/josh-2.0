import { describe, expect, it } from "vitest";
import {
  clearInMemoryMetrics,
  emitMetric,
  elapsedMetricMs,
  getInMemoryMetrics,
  nowMetricMs,
} from "../../packages/core/src/observability/metrics";
import {
  METRIC_CATALOG,
  validateMetricCatalog,
} from "../../packages/core/src/observability/metrics-catalog";
import { estimateLlmCostUsd } from "../../packages/core/src/observability/llm-pricing";

describe("metrics emitter", () => {
  it("rejects unknown metric names", () => {
    expect(() =>
      emitMetric({
        metric: "unknown.metric",
        value: 1,
      })
    ).toThrow("Unknown metric");
  });

  it("validates the canonical metrics catalog", () => {
    expect(validateMetricCatalog(METRIC_CATALOG)).toEqual({ valid: true });
  });

  it("drops PII-like tags from emitted payloads", () => {
    clearInMemoryMetrics();
    const emitted = emitMetric({
      metric: "system.error.count",
      value: 1,
      correlation_id: "corr_metrics_1",
      tags: {
        component: "unit_test",
        email: "alex@example.com",
        from_e164: "+14155551212",
        body_raw: "call me",
        phase: "handler",
      },
    });

    const serialized = JSON.stringify(emitted);
    expect(serialized).not.toContain("alex@example.com");
    expect(serialized).not.toContain("4155551212");
    expect(emitted.tags.component).toBe("unit_test");
    expect(emitted.tags.phase).toBe("handler");
    expect(emitted.correlation_id).toBe("corr_metrics_1");
  });

  it("emits latency histogram metrics with millisecond values", () => {
    clearInMemoryMetrics();
    const startedAt = nowMetricMs();
    const elapsed = elapsedMetricMs(startedAt);

    const emitted = emitMetric({
      metric: "system.request.latency",
      value: elapsed,
      tags: {
        component: "unit_test",
        operation: "latency_probe",
        outcome: "success",
      },
    });

    expect(emitted.metric).toBe("system.request.latency");
    expect(emitted.type).toBe("histogram");
    expect(emitted.unit).toBe("ms");
    expect(emitted.value).toBeGreaterThanOrEqual(0);
  });
});

describe("llm pricing", () => {
  it("computes deterministic USD estimates from token usage", () => {
    const estimate = estimateLlmCostUsd({
      model: "claude-3-5-haiku-latest",
      input_tokens: 1_000,
      output_tokens: 500,
    });

    expect(estimate.input_tokens).toBe(1_000);
    expect(estimate.output_tokens).toBe(500);
    expect(estimate.total_nano_usd).toBe(2_800_000);
    expect(estimate.estimated_cost_usd).toBe(0.0028);
  });
});
