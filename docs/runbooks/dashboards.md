# Dashboards Runbook — Ticket 13.3

Canonical metrics are defined in:

- `packages/core/src/observability/metrics-catalog.ts`

Runtime metric emission is implemented in:

- `packages/core/src/observability/metrics.ts`
- `packages/core/src/observability/logger.ts` (derived metric mapping from canonical events)

## Product Health Dashboard Inputs

- `conversation.session.started`
- `conversation.mode.transition`
- `conversation.linkup.created`
- `conversation.linkup.completed`
- `post_event.attendance.recorded`
- `post_event.do_again.recorded`
- `post_event.exchange.revealed`

## Reliability Dashboard Inputs

- `system.error.count`
- `system.rpc.failure.count`
- `system.request.latency`
- `llm.request.count`

## Safety Dashboard Inputs

- `safety.keyword.detected`
- `safety.strike.applied`
- `safety.crisis.intercepted`

## Cost Dashboard Inputs

- `llm.token.input`
- `llm.token.output`
- `llm.cost.estimated_usd`

The current adapter is in-process and requires no external click-ops to emit canonical metric payloads.
