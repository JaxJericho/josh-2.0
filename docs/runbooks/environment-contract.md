# Environment Contract - JOSH 2.0

This document is the canonical environment contract for JOSH 2.0.
If this file conflicts with any other env-var doc, this file wins.

## Environment Map

- Local
  - Purpose: development, local verification, and scripts.
  - Set locations: `.env.local` and/or shell environment when running commands.
- Staging
  - Vercel URL: `https://josh-2-0-staging.vercel.app`
  - Set locations:
    - Vercel project env vars (staging project, `Production` scope)
    - Supabase staging project secrets (Edge Functions/Auth settings)
  - Known configured in Vercel staging `Production` scope: `APP_ENV=staging`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- Production
  - Vercel URL: `https://josh-2-0-production.vercel.app`
  - Custom domain: `https://www.callmejosh.ai` (apex `callmejosh.ai` redirects)
  - Set locations:
    - Vercel project env vars (production project, `Production` scope)
    - Supabase production project secrets (Edge Functions/Auth settings)

## Canonical Variable Contract

`Required` means required for the referenced runtime path to work in that environment.

### App

| Name | Required | Used by | Format / constraints | Where set (local / staging / production) | Security / rotation notes |
|---|---|---|---|---|---|
| `APP_ENV` | No | Environment labeling and future runtime branching | Lowercase enum; use `local`, `staging`, `production` | Local: `.env.local` optional. Staging: Vercel staging project `Production` scope (`staging` value). Production: Vercel production project `Production` scope (`production` value). | Non-secret. Keep consistent with deploy target. |
| `NODE_ENV` | No (platform-managed) | `app/lib/observability.ts` fallback env tag | `development` / `production` / `test` | Local: set automatically by Next.js/Node. Staging/Production: set by Vercel runtime. | Non-secret. Do not force-overwrite in app code. |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes (near-term web client use) | Planned web app client-side Supabase access | Must be valid `https://<project-ref>.supabase.co` URL | Local: `.env.local`. Staging: Vercel staging env. Production: Vercel production env. | Public value, non-secret. Must still be environment-specific. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes (near-term web client use) | Planned web app client-side Supabase auth | JWT-like anon key string from same Supabase project as URL | Local: `.env.local`. Staging: Vercel staging env. Production: Vercel production env. | Public key but environment-isolated. Rotate if leaked with related project changes. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Yes (near-term web billing UI use) | Planned Stripe checkout UI flows | `pk_test_...` in staging/local, `pk_live_...` in production | Local: `.env.local`. Staging: Vercel staging env. Production: Vercel production env. | Public key, non-secret. Never mix test/live across envs. |

### Supabase

| Name | Required | Used by | Format / constraints | Where set (local / staging / production) | Security / rotation notes |
|---|---|---|---|---|---|
| `SUPABASE_URL` | Yes | Next API route (`app/api/webhooks/twilio/status/route.ts`), Supabase Edge Functions | Valid Supabase REST base URL, no trailing spaces | Local: `.env.local`/shell. Staging: Vercel staging env and Supabase staging function secret. Production: Vercel production env and Supabase production function secret. | Treat as sensitive operational config. Keep per-env separation. |
| `SUPABASE_ANON_KEY` | Yes (web + tooling) | Current tooling fingerprints; near-term web client usage | Supabase anon key for matching project URL | Local: `.env.local`/shell. Staging: Vercel staging env. Production: Vercel production env. | Public-ish key but still scoped by env and RLS. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Next API route and Supabase Edge Functions privileged writes | Service role key string from same project as `SUPABASE_URL` | Local: `.env.local`/shell and local function runtime. Staging: Vercel staging env + Supabase staging secrets. Production: Vercel production env + Supabase production secrets. | Secret. High privilege. Rotate immediately if exposed. |
| `PROJECT_REF` | Yes | Supabase Edge Functions Twilio signature canonical URL fallback | Supabase project ref slug, lowercase alnum | Local: shell for `supabase functions serve`. Staging: Supabase staging function secret. Production: Supabase production function secret. | Non-secret but correctness-critical for signature verification. |
| `SUPABASE_FUNCTIONS_URL` | No (tooling) | `scripts/doctor.mjs` URL-shape checks | `https://<project-ref>.supabase.co/functions/v1` without query params | Local: shell/`.env.local` when running doctor checks. Staging/Production: optional in Vercel env for diagnostics only. | Non-secret. Keep aligned with active Supabase project. |
| `SUPABASE_DB_URL` | No (tooling) | `package.json` `db:seed` command | PostgreSQL URL | Local only: shell export when overriding default local URL. Not used in staging/production runtime. | Secret. Do not print. |
| `SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN` | No (optional Supabase Auth SMS provider config) | `supabase/config.toml` `auth.sms.twilio` (currently disabled) | Twilio auth token format | Local: shell when enabling local Supabase Auth Twilio provider. Staging/Production: set only if using Supabase Auth SMS provider there. | Secret. Rotate with Twilio auth token rotation. |
| `SUPABASE_AUTH_EXTERNAL_APPLE_SECRET` | No (optional Supabase Auth provider) | `supabase/config.toml` Apple auth provider (currently disabled) | Apple OAuth client secret JWT | Local: shell when enabling provider locally. Staging/Production: set only if Apple provider enabled. | Secret. Rotate per Apple key lifecycle. |
| `S3_HOST` | No (optional local Supabase experimental storage) | `supabase/config.toml` experimental OrioleDB S3 settings | Valid S3 host (no protocol) | Local only when enabling experimental config. Not required for staging/production app runtime. | Sensitive infrastructure config. |
| `S3_REGION` | No | Same as above | AWS region format, e.g. `us-east-1` | Local optional. | Non-secret. |
| `S3_ACCESS_KEY` | No | Same as above | AWS access key id format | Local optional. | Secret. Rotate if exposed. |
| `S3_SECRET_KEY` | No | Same as above | AWS secret access key | Local optional. | Secret. Rotate if exposed. |

### Twilio

| Name | Required | Used by | Format / constraints | Where set (local / staging / production) | Security / rotation notes |
|---|---|---|---|---|---|
| `TWILIO_ACCOUNT_SID` | Yes | `supabase/functions/twilio-outbound-runner` send API calls | Must start with `AC` and match account for auth token | Local: shell for function serve. Staging: Supabase staging function secret. Production: Supabase production function secret. | Sensitive account identifier; rotate only via account migration. |
| `TWILIO_AUTH_TOKEN` | Yes | Twilio webhook signature verification and outbound API auth | Twilio auth token string | Local: `.env.local`/shell and local functions. Staging: Vercel staging env + Supabase staging secrets. Production: Vercel production env + Supabase production secrets. | Secret. Rotate immediately if leaked. |
| `TWILIO_MESSAGING_SERVICE_SID` | Yes (or `TWILIO_FROM_NUMBER`) | Outbound runner sender identity | Must start with `MG` when set | Local: shell optional. Staging: Supabase staging secrets. Production: Supabase production secrets. | Sensitive operational config. |
| `TWILIO_FROM_NUMBER` | Yes (if no `TWILIO_MESSAGING_SERVICE_SID`) | Outbound runner fallback sender number | E.164 phone number (`+1...`) | Local: shell optional. Staging: Supabase staging secrets. Production: Supabase production secrets. | Operationally sensitive; keep per-env Twilio numbers separated. |
| `TWILIO_STATUS_CALLBACK_URL` | No (recommended) | Next status callback signature URL candidate and outbound runner status callback override | Absolute `https://.../api/webhooks/twilio/status` for Next route or Supabase function URL fallback path | Local: optional shell. Staging: Vercel staging env + Supabase staging secrets. Production: Vercel production env + Supabase production secrets. | Non-secret but correctness-critical for signature validation. |
| `TWILIO_WEBHOOK_SIGNING_SECRET` | No (planned/optional) | Near-term spec placeholder for alternate verification model | Twilio webhook secret/token string | Only set if code path adopts this variable. Currently unset in all envs. | Secret if introduced. |

### Stripe

| Name | Required | Used by | Format / constraints | Where set (local / staging / production) | Security / rotation notes |
|---|---|---|---|---|---|
| `STRIPE_SECRET_KEY` | Yes (near-term billing runtime) | Billing webhook and entitlement logic (planned), tooling fingerprints | `sk_test_...` outside prod, `sk_live_...` in prod | Local: `.env.local` optional. Staging: Vercel staging env. Production: Vercel production env. | Secret. Rotate via Stripe dashboard and redeploy. |
| `STRIPE_WEBHOOK_SECRET` | Yes (near-term billing runtime) | Stripe webhook signature verification (planned), tooling fingerprints | `whsec_...` | Local: `.env.local` optional for local webhook tests. Staging: Vercel staging env. Production: Vercel production env. | Secret. Rotate when endpoint/signing secret changes. |

### LLM

| Name | Required | Used by | Format / constraints | Where set (local / staging / production) | Security / rotation notes |
|---|---|---|---|---|---|
| `ANTHROPIC_API_KEY` | Yes (near-term interview/routing runtime) | Planned intent detection and profile extraction flows | `sk-ant-...` style key | Local: `.env.local` for local dev tests. Staging: Vercel staging env. Production: Vercel production env. | Secret. Rotate per provider policy. |
| `OPENAI_API_KEY` | No | `supabase/config.toml` Studio AI helper in local stack | OpenAI API key format | Local only if using Supabase Studio AI helper. Not required in staging/production runtime. | Secret. Optional for local developer tooling. |

### Encryption

| Name | Required | Used by | Format / constraints | Where set (local / staging / production) | Security / rotation notes |
|---|---|---|---|---|---|
| `SMS_BODY_ENCRYPTION_KEY` | Yes | `twilio-inbound` encrypt RPC and `twilio-outbound-runner` decrypt RPC | High-entropy passphrase; minimum 32+ chars recommended | Local: shell for local functions and scripts. Staging: Supabase staging function secret. Production: Supabase production function secret. | Secret. Rotate with key-version migration and dual-read plan. |

### Cron / Scheduler

| Name | Required | Used by | Format / constraints | Where set (local / staging / production) | Security / rotation notes |
|---|---|---|---|---|---|
| `CRON_SECRET` | Yes | `app/api/cron/twilio-outbound-runner/route.ts` bearer auth | Random high-entropy token; no whitespace | Local: `.env.local` for local cron endpoint tests. Staging: Vercel staging env. Production: Vercel production env. | Secret. Rotate with cron config update in lockstep. |
| `STAGING_RUNNER_URL` | Yes | Next cron route -> Supabase runner target | Absolute URL; MUST NOT contain `?` | Local: optional for local imitation. Staging: Vercel staging env. Production: not used in prod runtime. | Non-secret but correctness-critical. |
| `STAGING_RUNNER_SECRET` | Yes | Next cron route body token to runner | Must exactly match runner-side expected secret | Local: optional. Staging: Vercel staging env. Production: not used in prod runtime. | Secret. Must match `QSTASH_RUNNER_SECRET` in target function environment. |
| `LOCAL_RUNNER_URL` | No (tooling) | `scripts/doctor.mjs` checks | Absolute URL with no query string | Local shell only. | Non-secret. |
| `LOCAL_RUNNER_SECRET` | No (tooling) | `scripts/doctor.mjs`, `scripts/print-env-fingerprint.mjs` | Secret token | Local shell only. | Secret. |
| `PRODUCTION_RUNNER_URL` | No (tooling / future parity checks) | `scripts/doctor.mjs` checks | Absolute URL with no query string | Local shell optional for diagnostics. | Non-secret. |
| `PRODUCTION_RUNNER_SECRET` | No (tooling / future parity checks) | `scripts/doctor.mjs`, `scripts/print-env-fingerprint.mjs` | Secret token | Local shell optional for diagnostics. | Secret. |
| `QSTASH_CURRENT_SIGNING_KEY` | Yes (QStash signature auth path) | `supabase/functions/twilio-outbound-runner` signature validation | Upstash signing key | Local: shell for local signed tests. Staging: Supabase staging function secret. Production: Supabase production function secret. | Secret. Rotate using current/next overlap. |
| `QSTASH_NEXT_SIGNING_KEY` | Yes (QStash signature auth path) | Same as above | Upstash next signing key | Local: shell for local signed tests. Staging: Supabase staging function secret. Production: Supabase production function secret. | Secret. Maintain overlap during rotation. |
| `QSTASH_RUNNER_SECRET` | Yes (body-token auth fallback and current Next cron chain) | `supabase/functions/twilio-outbound-runner` fallback auth | Random secret token; compared timing-safe | Local: shell optional. Staging: Supabase staging function secret. Production: Supabase production function secret (if fallback retained). | Secret. Must be synchronized with caller secret when body-token mode is used. |
| `QSTASH_AUTH_DEBUG` | No | Runner unauthorized debug payload toggle | `1` to enable, unset/`0` to disable | Local only for debugging. Staging/Production should remain unset. | Non-secret but can leak auth diagnostics; keep disabled outside controlled debugging. |
| `QSTASH_ECHO_SECRET` | Yes (only if qstash-echo endpoint enabled) | `supabase/functions/qstash-echo` auth guard | Random secret token | Local: shell for local diagnostics. Staging: Supabase staging function secret. Production: Supabase production secret only if endpoint retained. | Secret. Rotate after any exposure. |

### Observability

| Name | Required | Used by | Format / constraints | Where set (local / staging / production) | Security / rotation notes |
|---|---|---|---|---|---|
| `SENTRY_DSN` | Yes (staging/prod observability), No (local) | `sentry.server.config.ts`, `sentry.edge.config.ts` | Valid DSN URL | Local: optional `.env.local`. Staging: Vercel staging env. Production: Vercel production env. | Secret-ish endpoint token. Rotate via Sentry project settings. |
| `NEXT_PUBLIC_SENTRY_DSN` | Yes (staging/prod client observability), No (local) | `sentry.client.config.ts` | Valid public DSN URL | Local: optional `.env.local`. Staging: Vercel staging env. Production: Vercel production env. | Public DSN; still keep environment-specific. |
| `SENTRY_ENVIRONMENT` | Yes | Observability labels and staging-only test gating | Enum: `local` / `staging` / `production` | Local: `.env.local` optional (`local`). Staging: Vercel staging env (`staging`). Production: Vercel production env (`production`). | Non-secret. Must match deployment environment. |
| `SENTRY_AUTH_TOKEN` | No (build-time optional) | Planned source map upload and CI release integration | Sentry auth token | Local optional for manual release tooling. Staging/Production CI env if source-map upload enabled. | Secret. Restrict to CI context. |

### Verification Script Inputs (local tooling)

| Name | Required | Used by | Format / constraints | Where set (local / staging / production) | Security / rotation notes |
|---|---|---|---|---|---|
| `DOCTOR_REMOTE` | No | `scripts/doctor.mjs` remote-check toggle | `1` to enable remote mode | Local shell only. | Non-secret. |
| `TWILIO_REPLAY_MODE` | No | `scripts/verify/twilio_inbound_replay.mjs` request shape selector | `inbound` or `status` | Local shell only. | Non-secret. |
| `TWILIO_INBOUND_URL` | No | Replay script inbound target URL | Absolute URL | Local shell only. | Non-secret. |
| `TWILIO_STATUS_CALLBACK_URL` | No | Replay script status-callback target URL | Absolute URL | Local shell only. | Non-secret. |
| `WEBHOOK_URL` | No | `scripts/verify/twilio_inbound_replay.mjs` target URL | Absolute URL | Local shell only. | Non-secret. |
| `SIGNATURE_URL` | No | Same replay script, canonical URL for signature base string | Absolute URL | Local shell only. | Non-secret. |
| `EXPECT_STATUS` | No | Replay script expected HTTP status | Integer HTTP status code | Local shell only. | Non-secret. |
| `FORWARDED_HOST` | No | Replay script forwarded-host override | Hostname only | Local shell only. | Non-secret. |
| `FORWARDED_PROTO` | No | Replay script forwarded-proto override | `http` or `https` | Local shell only. | Non-secret. |
| `FROM_E164` | No | Replay script payload | E.164 number | Local shell only. | Non-secret test data. |
| `TO_E164` | No | Replay script payload | E.164 number | Local shell only. | Non-secret test data. |
| `BODY` | No | Replay script payload | Short text body | Local shell only. | Do not use real PII in tests. |
| `MESSAGE_SID` | No | Replay script payload idempotency key | Twilio SID-like string (`SM...`) | Local shell only. | Non-secret test id. |
| `NUM_MEDIA` | No | Replay script payload | Integer string (`0`, `1`, ...) | Local shell only. | Non-secret. |
| `MESSAGE_STATUS` | No | Replay script status-callback payload | Twilio callback status string (`sent`, `delivered`, etc.) | Local shell only. | Non-secret. |

### Template-Only Placeholders In `supabase/config.toml`

These variables are referenced in commented template lines and are not active runtime requirements unless those blocks are enabled:

- `SENDGRID_API_KEY`
- `SECRET_VALUE`

## Verification and Guidance

Use these checks to keep this contract complete and accurate.

### 1) Enumerate env-var usage from code/config

```bash
rg -n "process\.env(\.|\[)|Deno\.env\.get\(|env\([A-Z0-9_]+\)" app supabase scripts supabase/config.toml
```

### 2) List unique env names from Node runtime usage

```bash
rg -No "process\.env\.([A-Z0-9_]+)" app scripts sentry.*.ts | sed -E 's/.*process\.env\.([A-Z0-9_]+).*/\1/' | sort -u
```

### 3) List unique env names from Deno Edge Function usage

```bash
rg -No "Deno\.env\.get\(\s*['\"]([A-Z0-9_]+)['\"]" supabase/functions | sed -E "s/.*Deno\.env\.get\(\s*['\"]([A-Z0-9_]+)['\"].*/\1/" | sort -u
```

### 4) Validate quality gates and catch env-related breakage

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

### 5) Safe secret verification (no secret values)

```bash
pnpm env:fingerprint
node scripts/doctor.mjs
```

## Reconciliation

- `docs/architecture/environment-variables.md` is deprecated for canonical inventory details and now points here.
- Keep any new env vars added in code synchronized in this file in the same PR.
