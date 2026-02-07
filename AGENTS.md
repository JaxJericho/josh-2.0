# AGENTS

This repository is operated by AI coding assistants (Codex and Claude Code). Follow these rules exactly.

## Operating Rules (Non-Negotiable)

* One ticket per branch. One PR per ticket.  
* Minimal scoped changes only. No broad refactors.  
* Preserve existing behavior outside the ticket scope.  
* Prioritize: least privilege, secure-by-default auth, idempotency, retry safety.  
* Never print secrets. Never commit secrets. Never paste secrets into output.  
* If authoritative docs conflict, stop and ask for a decision instead of guessing.

## Authoritative Docs (Must Read Before Planning)

1. Build Plan (Authoritative)  
* `docs/specs/josh-2.0/JOSH 2.0 Comprehensive Build Plan.md`  
2. Workflow Rules  
* `docs/setup/build-loop.md`  
* `docs/setup/ticket-workflow-and-pr-rules.md`  
* `docs/setup/verification-checklist.md`  
3. Architecture Boundaries  
* `docs/architecture/environments.md`  
* `docs/architecture/environment-variables.md`  
* `docs/architecture/runtime-boundaries.md`  
* `docs/architecture/database-boundaries.md`  
* `docs/architecture/migrations.md`  
4. Security  
* `SECURITY.md`

## Where Things Live

* Supabase Edge Functions: `supabase/functions/`  
* Supabase migrations: `supabase/migrations/`  
* Scripts: `scripts/`  
* Verification helpers: `verify/`  
* Runbooks: `docs/runbooks/`  
* Specs (authoritative): `docs/specs/josh-2.0/`

## Scheduling (Current)

The scheduler path is:

* Vercel Cron \-\> protected Next.js route \-\> Supabase Edge Function runner

Do not introduce any alternative scheduler unless the ticket explicitly requires it.

## Environment And Secrets

* Env var names are documented in `docs/architecture/environment-variables.md`.  
* Do not assume env vars exist. If you add any, document them (names only) and add to `.env.example` if the repo uses it.  
* When debugging env vars, print only:  
  * set/unset  
  * length  
  * sha256 prefix  
    Never print values.

## Required Verification Commands

Run these unless the ticket explicitly states otherwise:

* `pnpm lint`  
* `pnpm typecheck` (if present)  
* `pnpm test` (if present)  
* `pnpm build`

If the ticket touches database schema or generated types, also follow:

* `docs/architecture/migrations.md`

## Required Git Workflow

Run these exact steps and do not skip:

* `git checkout main`  
* `git pull`  
* `git checkout -b <BRANCH_NAME>`  
* (make changes)  
* `git add -A`  
* `git commit -m "<COMMIT_MESSAGE>"`  
* `git push -u origin <BRANCH_NAME>`

If you cannot commit/push due to missing permissions or repo access, say so explicitly and output the exact commands the user should run locally.

## Required PR Output

At the end of the ticket, provide:

* Deliverables summary  
* Files changed  
* Env vars added/changed (names only)  
* Migrations added (filenames) and whether applied  
* Local verification commands run and results  
* Staging verification steps (if applicable)  
* Manual dashboard steps (if applicable)  
* PR title and PR body aligned to the repo’s PR rules