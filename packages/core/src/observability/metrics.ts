import {
  METRIC_CATALOG_BY_NAME,
  type MetricName,
  type MetricType,
} from "./metrics-catalog.ts";

export type MetricTags = Record<string, string | number | boolean | null | undefined>;

export type EmitMetricInput = {
  metric: MetricName | string;
  value: number;
  tags?: MetricTags;
  correlation_id?: string | null;
  ts?: string | Date;
};

export type EmittedMetric = {
  ts: string;
  metric: MetricName;
  type: MetricType;
  unit: string;
  value: number;
  env: "local" | "staging" | "production";
  correlation_id: string | null;
  tags: Record<string, string>;
};

export type MetricAdapter = {
  emit(metric: EmittedMetric): void;
};

const MAX_BUFFERED_METRICS = 2_000;
const MAX_TAG_VALUE_LENGTH = 96;
const TAG_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_PATTERN = /(?:\+?\d[\d().\-\s]{8,}\d)/;
const PII_TAG_KEY_PATTERN =
  /(phone|email|first_name|last_name|full_name|name|message|body|contact|report_reason|free_text)/i;

class InMemoryMetricAdapter implements MetricAdapter {
  private readonly buffer: EmittedMetric[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries: number = MAX_BUFFERED_METRICS) {
    this.maxEntries = maxEntries;
  }

  emit(metric: EmittedMetric): void {
    this.buffer.push(metric);
    if (this.buffer.length > this.maxEntries) {
      this.buffer.splice(0, this.buffer.length - this.maxEntries);
    }
  }

  snapshot(limit?: number): EmittedMetric[] {
    if (!limit || limit <= 0) {
      return [...this.buffer];
    }
    return this.buffer.slice(-limit);
  }

  clear(): void {
    this.buffer.length = 0;
  }
}

const defaultInMemoryAdapter = new InMemoryMetricAdapter();
let activeMetricAdapter: MetricAdapter = defaultInMemoryAdapter;

export function setMetricAdapter(adapter: MetricAdapter): void {
  activeMetricAdapter = adapter;
}

export function resetMetricAdapter(): void {
  activeMetricAdapter = defaultInMemoryAdapter;
}

export function clearInMemoryMetrics(): void {
  defaultInMemoryAdapter.clear();
}

export function getInMemoryMetrics(limit?: number): EmittedMetric[] {
  return defaultInMemoryAdapter.snapshot(limit);
}

export function emitMetric(input: EmitMetricInput): EmittedMetric {
  const metricName = normalizeMetricName(input.metric);
  const definition = METRIC_CATALOG_BY_NAME[metricName];
  if (!definition) {
    throw new Error(`Unknown metric '${input.metric}'.`);
  }

  const numericValue = normalizeMetricValue(input.value, definition.unit);
  const tags = sanitizeTags(input.tags);
  const correlationId = normalizeCorrelationId(input.correlation_id, tags);

  delete tags.correlation_id;

  const metric: EmittedMetric = {
    ts: normalizeTimestamp(input.ts),
    metric: metricName,
    type: definition.type,
    unit: definition.unit,
    value: numericValue,
    env: detectRuntimeEnv(),
    correlation_id: correlationId,
    tags,
  };

  activeMetricAdapter.emit(metric);
  return metric;
}

export function emitMetricBestEffort(input: EmitMetricInput): EmittedMetric | null {
  try {
    return emitMetric(input);
  } catch {
    return null;
  }
}

export function emitSystemErrorMetric(input: {
  correlation_id?: string | null;
  component: string;
  phase?: string | null;
  error_name?: string | null;
}): EmittedMetric | null {
  return emitMetricBestEffort({
    metric: "system.error.count",
    value: 1,
    correlation_id: input.correlation_id ?? null,
    tags: {
      component: input.component,
      phase: input.phase ?? "unknown",
      error_name: input.error_name ?? "Error",
    },
  });
}

export function emitRpcFailureMetric(input: {
  correlation_id?: string | null;
  component: string;
  rpc_name: string;
}): EmittedMetric | null {
  return emitMetricBestEffort({
    metric: "system.rpc.failure.count",
    value: 1,
    correlation_id: input.correlation_id ?? null,
    tags: {
      component: input.component,
      rpc_name: input.rpc_name,
    },
  });
}

export function nowMetricMs(): number {
  if (
    typeof performance !== "undefined" &&
    typeof performance.now === "function"
  ) {
    return performance.now();
  }
  return Date.now();
}

export function elapsedMetricMs(startedAtMs: number): number {
  const elapsed = nowMetricMs() - startedAtMs;
  if (!Number.isFinite(elapsed) || elapsed < 0) {
    return 0;
  }
  return roundToThree(elapsed);
}

function normalizeMetricName(value: string): MetricName {
  const normalized = value.trim() as MetricName;
  return normalized;
}

function normalizeMetricValue(value: number, unit: string): number {
  if (!Number.isFinite(value)) {
    throw new Error("Metric value must be a finite number.");
  }
  if (unit === "usd") {
    return roundToSix(value);
  }
  if (unit === "count" || unit === "tokens") {
    return Math.round(value);
  }
  return roundToThree(value);
}

function sanitizeTags(tags?: MetricTags): Record<string, string> {
  if (!tags) {
    return {};
  }

  const output: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(tags)) {
    const key = rawKey.trim().toLowerCase();
    if (!TAG_KEY_PATTERN.test(key)) {
      continue;
    }
    if (PII_TAG_KEY_PATTERN.test(key)) {
      continue;
    }

    const normalizedValue = normalizeTagValue(rawValue);
    if (!normalizedValue) {
      continue;
    }
    if (containsPotentialPii(normalizedValue)) {
      continue;
    }

    output[key] = normalizedValue.slice(0, MAX_TAG_VALUE_LENGTH);
  }
  return output;
}

function normalizeTagValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return null;
    }
    return String(value);
  }
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  return normalized;
}

function containsPotentialPii(value: string): boolean {
  if (EMAIL_PATTERN.test(value)) {
    return true;
  }
  if (PHONE_PATTERN.test(value)) {
    const digits = value.replace(/\D/g, "");
    if (digits.length >= 10) {
      return true;
    }
  }
  return false;
}

function normalizeCorrelationId(
  explicitCorrelationId: string | null | undefined,
  tags: Record<string, string>,
): string | null {
  const explicit = normalizeTagValue(explicitCorrelationId);
  if (explicit && !containsPotentialPii(explicit)) {
    return explicit;
  }

  const candidate = tags.correlation_id;
  if (candidate && !containsPotentialPii(candidate)) {
    return candidate;
  }
  return null;
}

function normalizeTimestamp(ts?: string | Date): string {
  if (!ts) {
    return new Date().toISOString();
  }
  if (ts instanceof Date) {
    return ts.toISOString();
  }
  const parsed = new Date(ts);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
}

function detectRuntimeEnv(): "local" | "staging" | "production" {
  const appEnv = readEnv("APP_ENV");
  if (appEnv === "staging") {
    return "staging";
  }
  if (appEnv === "production" || appEnv === "prod") {
    return "production";
  }

  const sentryEnv = readEnv("SENTRY_ENVIRONMENT");
  if (sentryEnv === "staging") {
    return "staging";
  }
  if (sentryEnv === "production" || sentryEnv === "prod") {
    return "production";
  }
  return "local";
}

function readEnv(name: string): string | null {
  const denoRuntime = (globalThis as unknown as {
    Deno?: { env?: { get?: (key: string) => string | undefined } };
  }).Deno;
  const denoValue = denoRuntime?.env?.get?.(name);
  if (typeof denoValue === "string" && denoValue.trim()) {
    return denoValue.trim().toLowerCase();
  }

  const nodeRuntime = (globalThis as unknown as {
    process?: { env?: Record<string, string | undefined> };
  }).process;
  const nodeValue = nodeRuntime?.env?.[name];
  if (typeof nodeValue === "string" && nodeValue.trim()) {
    return nodeValue.trim().toLowerCase();
  }
  return null;
}

function roundToThree(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function roundToSix(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
