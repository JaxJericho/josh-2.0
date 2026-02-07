# AI Assistant Start Here

This repository is designed to be worked on by Claude Code and Codex using a strict ticket workflow.

## The One Rule

One ticket per branch and one PR per ticket.

## What To Read First

Read these in order before making changes:

1. Build Loop  
* `docs/setup/build-loop.md`  
2. Ticket Workflow \+ PR Rules  
* `docs/setup/ticket-workflow-and-pr-rules.md`  
3. Verification Checklist  
* `docs/setup/verification-checklist.md`  
4. Build Plan (Authoritative)  
* `docs/specs/josh-2.0/JOSH 2.0 Comprehensive Build Plan.md`  
5. Architecture Boundaries  
* `docs/architecture/runtime-boundaries.md`  
* `docs/architecture/database-boundaries.md`  
* `docs/architecture/environments.md`  
* `docs/architecture/environment-variables.md`  
* `docs/architecture/migrations.md`

## Where To Look For Implementations

* Supabase Edge Functions: `supabase/functions/`  
* Migrations: `supabase/migrations/`  
* Scripts: `scripts/`  
* Verification helpers: `verify/`

## Runbooks (Operational Truth)

* Twilio: `docs/runbooks/` (see Twilio-related runbooks)  
* Stripe: `docs/runbooks/` (see Stripe-related runbooks)  
* Scheduling: follow the build plan (Vercel Cron). Do not introduce alternative schedulers unless a ticket explicitly requires it.

## Safety And Secrets

* Never print or log secret values.  
* Never commit secrets.  
* When debugging env vars, print only: set/unset, length, sha256 prefix.

## If Anything Conflicts

If any doc conflicts with another, stop and ask for a decision rather than guessing.

## Expected Output For Each Ticket

Every ticket PR must include:

* Summary of changes  
* Files changed  
* Env vars added/changed (names only)  
* Migrations added/applied (filenames)  
* Local verification commands run  
* Staging verification steps (if applicable)  
* Manual dashboard steps (if applicable)

## Templates (Use These)

Use these templates to keep agent work consistent and low-risk:

* `docs/ai/definitions.md` — glossary for core terms  
* `docs/ai/ticket-template.md` — standard ticket format  
* `docs/ai/prompt-template.md` — canonical prompt template  
* `docs/ai/claude-code-template.md` — Claude Code prompt scaffold  
* `docs/ai/codex-template.md` — Codex prompt scaffold  
* `.github/pull_request_template.md` — required PR format

## Which Template To Use When

* Starting a new ticket: `docs/ai/prompt-template.md`  
* Writing a ticket brief: `docs/ai/ticket-template.md`  
* Defining terms: `docs/ai/definitions.md`  
* Running Claude Code: `docs/ai/claude-code-template.md`  
* Running Codex: `docs/ai/codex-template.md`
