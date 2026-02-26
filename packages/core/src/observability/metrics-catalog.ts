export type MetricType = "counter" | "histogram" | "gauge";

export type MetricCatalogEntry = {
  metric_name: string;
  type: MetricType;
  description: string;
  tags: readonly string[];
  unit: string;
};

export const METRIC_CATALOG = [
  {
    metric_name: "system.error.count",
    type: "counter",
    description: "Unhandled runtime errors across app and function surfaces.",
    tags: ["component", "phase", "error_name"],
    unit: "count",
  },
  {
    metric_name: "system.rpc.failure.count",
    type: "counter",
    description: "RPC failures from database-backed orchestration paths.",
    tags: ["component", "rpc_name"],
    unit: "count",
  },
  {
    metric_name: "system.request.latency",
    type: "histogram",
    description: "Latency for inbound pipeline, routers, engines, admin routes, and LLM calls.",
    tags: ["component", "operation", "outcome"],
    unit: "ms",
  },
  {
    metric_name: "conversation.session.started",
    type: "counter",
    description: "Conversation sessions initialized for a user.",
    tags: ["component", "route"],
    unit: "count",
  },
  {
    metric_name: "conversation.mode.transition",
    type: "counter",
    description: "Conversation mode transitions across router-managed session changes.",
    tags: ["component", "previous_mode", "next_mode", "reason"],
    unit: "count",
  },
  {
    metric_name: "conversation.linkup.created",
    type: "counter",
    description: "LinkUp lifecycle entries observed from runtime flows.",
    tags: ["component", "source"],
    unit: "count",
  },
  {
    metric_name: "conversation.linkup.completed",
    type: "counter",
    description: "LinkUps observed as completed and transitioned into post-event flow.",
    tags: ["component", "source"],
    unit: "count",
  },
  {
    metric_name: "safety.keyword.detected",
    type: "counter",
    description: "Safety keyword detections from inbound safety intercepts.",
    tags: ["component", "severity", "action"],
    unit: "count",
  },
  {
    metric_name: "safety.strike.applied",
    type: "counter",
    description: "Safety strike applications following keyword policy enforcement.",
    tags: ["component", "severity", "safety_hold"],
    unit: "count",
  },
  {
    metric_name: "safety.crisis.intercepted",
    type: "counter",
    description: "Crisis intercept actions from safety pipelines.",
    tags: ["component", "severity", "action"],
    unit: "count",
  },
  {
    metric_name: "post_event.attendance.recorded",
    type: "counter",
    description: "Post-event attendance outcomes captured from users.",
    tags: ["component", "attendance_result", "reason"],
    unit: "count",
  },
  {
    metric_name: "post_event.do_again.recorded",
    type: "counter",
    description: "Post-event do-again outcomes captured from users.",
    tags: ["component", "do_again", "reason"],
    unit: "count",
  },
  {
    metric_name: "post_event.exchange.revealed",
    type: "counter",
    description: "Mutual contact exchanges revealed to participants.",
    tags: ["component", "exchange_choice", "blocked_by_safety"],
    unit: "count",
  },
  {
    metric_name: "admin.action.count",
    type: "counter",
    description: "Admin actions persisted through canonical audit flow.",
    tags: ["component", "action", "target_type"],
    unit: "count",
  },
  {
    metric_name: "llm.request.count",
    type: "counter",
    description: "LLM extraction request attempts issued to a provider.",
    tags: ["component", "provider", "model", "attempt", "outcome"],
    unit: "count",
  },
  {
    metric_name: "llm.token.input",
    type: "counter",
    description: "Input tokens consumed by LLM extraction calls.",
    tags: ["component", "provider", "model"],
    unit: "tokens",
  },
  {
    metric_name: "llm.token.output",
    type: "counter",
    description: "Output tokens consumed by LLM extraction calls.",
    tags: ["component", "provider", "model"],
    unit: "tokens",
  },
  {
    metric_name: "llm.cost.estimated_usd",
    type: "gauge",
    description: "Deterministic estimated USD cost for each LLM extraction call.",
    tags: ["component", "provider", "model", "pricing_version"],
    unit: "usd",
  },
] as const satisfies readonly MetricCatalogEntry[];

export type MetricName = (typeof METRIC_CATALOG)[number]["metric_name"];

export const METRIC_CATALOG_BY_NAME: Readonly<Record<MetricName, (typeof METRIC_CATALOG)[number]>> =
  Object.freeze(
    METRIC_CATALOG.reduce((accumulator, entry) => {
      accumulator[entry.metric_name] = entry;
      return accumulator;
    }, {} as Record<MetricName, (typeof METRIC_CATALOG)[number]>),
  );

const METRIC_NAME_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;
const TAG_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

export function validateMetricCatalog(
  entries: readonly MetricCatalogEntry[] = METRIC_CATALOG,
): { valid: true } {
  const seenNames = new Set<string>();
  for (const entry of entries) {
    if (!METRIC_NAME_PATTERN.test(entry.metric_name)) {
      throw new Error(`Invalid metric_name '${entry.metric_name}'.`);
    }
    if (seenNames.has(entry.metric_name)) {
      throw new Error(`Duplicate metric_name '${entry.metric_name}'.`);
    }
    seenNames.add(entry.metric_name);

    if (entry.description.trim().length === 0) {
      throw new Error(`Metric '${entry.metric_name}' requires a non-empty description.`);
    }
    if (entry.unit.trim().length === 0) {
      throw new Error(`Metric '${entry.metric_name}' requires a non-empty unit.`);
    }

    const seenTags = new Set<string>();
    for (const tag of entry.tags) {
      if (!TAG_NAME_PATTERN.test(tag)) {
        throw new Error(`Metric '${entry.metric_name}' has invalid tag '${tag}'.`);
      }
      if (seenTags.has(tag)) {
        throw new Error(`Metric '${entry.metric_name}' has duplicate tag '${tag}'.`);
      }
      seenTags.add(tag);
    }
  }
  return { valid: true };
}

validateMetricCatalog(METRIC_CATALOG);
