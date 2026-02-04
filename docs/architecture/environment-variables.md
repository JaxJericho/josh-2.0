# Environment Variables — JOSH 2.0

This document defines the required environment variables for JOSH 2.0
and the rules governing their usage.

No database or infrastructure work may begin before this is defined.

---

## Variable Categories

### Public (Build-Time)

- Exposed to the client
- Safe to embed in builds
- Never contain secrets

Example:

- NEXT*PUBLIC*\*

---

### Server Runtime

- Available only on the server
- Required for application logic
- May include credentials

---

### Secrets

- Never committed
- Never logged
- Supplied only via environment configuration

---

## Environment Variable Rules

- No environment variable is shared across environments
- Local variables must never point to staging or production
- Production secrets must never exist on developer machines
- `.env.example` documents required variables only

---

## Required Variables (By Category)

### Database

- SUPABASE_URL
- SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY

---

### SMS / Messaging

- TWILIO_ACCOUNT_SID
- TWILIO_AUTH_TOKEN
- TWILIO_MESSAGING_SERVICE_SID

---

### Payments

- STRIPE_SECRET_KEY
- STRIPE_WEBHOOK_SECRET

---

### Deployment

- VERCEL_PROJECT_ID
- VERCEL_ORG_ID

---

## Local Development Rules

- Local uses sandbox credentials only
- Local `.env` files are ignored by Git
- `.env.example` must never contain real values

---

## Non-Negotiable Rule

If an environment variable’s scope or safety is unclear,
it must not be introduced.
