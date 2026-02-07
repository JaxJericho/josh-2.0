# Claude Code Instructions

## Working Style

Follow the Build Loop exactly. One ticket per branch and one PR per ticket.

* Make the smallest change set that satisfies the ticket goal.  
* Preserve existing behavior outside the ticket scope.  
* Prioritize least privilege, secure-by-default auth, and retry-safe idempotency.

## Do Not Do These

* Do not print or log secret values.  
* Do not commit secrets.  
* Do not introduce new crypto patterns.  
* Do not rename env vars unless the ticket explicitly requires it.  
* Do not do broad refactors.

## Authoritative Docs (Read First)

Open and follow these before planning changes:

* `docs/setup/build-loop.md`  
* `docs/setup/ticket-workflow-and-pr-rules.md`  
* `docs/setup/verification-checklist.md`  
* `docs/architecture/environments.md`  
* `docs/architecture/environment-variables.md`  
* `docs/architecture/runtime-boundaries.md`  
* `docs/architecture/database-boundaries.md`  
* `docs/architecture/migrations.md`

Build Plan:

* `docs/specs/josh-2.0/JOSH 2.0 Comprehensive Build Plan.md`

If any authoritative docs conflict, stop and ask for a decision.

## Commands You Must Use

Use these commands for verification unless the ticket says otherwise:

* `pnpm lint`  
* `pnpm typecheck` (if present)  
* `pnpm test` (if present)  
* `pnpm build`

If the ticket touches Supabase schema or types, also run the repo’s documented DB workflow from `docs/architecture/migrations.md` and `docs/architecture/environment-variables.md`.

## Repo Conventions

### Local Environment

* Use the repo’s existing env var documentation (`docs/architecture/environment-variables.md`).  
* Do not create new env var names unless required.  
* Never print env var values. If needed for debugging, print only: set/unset, length, and sha256 prefix.

### Scheduling

* QStash scheduling artifacts exist but are considered legacy.  
* New scheduling work must follow the build plan’s chosen scheduler path (Vercel Cron) unless the ticket explicitly says otherwise.

### Verification Helpers

* Prefer repo-local verify helpers over manual curl.  
* Check `verify/` and `scripts/` for existing tooling.

## Required Git Workflow

Run these exact steps and do not skip:

* `git checkout main`  
* `git pull`  
* `git checkout -b <BRANCH_NAME>`  
* (make changes)  
* `git add -A`  
* `git commit -m "<COMMIT_MESSAGE>"`  
* `git push -u origin <BRANCH_NAME>`

If you cannot commit/push due to missing access, say so explicitly and output the exact commands the user should run locally.

## Output Requirements

At the end of your work, always provide:

* Deliverables summary  
* Manual steps checklist (or say none)  
* Local verification checklist with command output summary  
* Staging verification checklist (if applicable)  
* PR title \+ PR body aligned to `.github/pull_request_template.md` (or the repo’s PR rules doc if that template is not present)