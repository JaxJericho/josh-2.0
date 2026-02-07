# Schema And Types Runbook — JOSH 2.0

This runbook is the canonical workflow to keep Supabase schema, migrations, and generated types in sync.

## Source Of Truth

- Migrations: `supabase/migrations/`
- Supabase config: `supabase/config.toml`
- Generated types (if used): `supabase/types/database.ts`

## Canonical Workflow (Local)

1. Start local Supabase (if not already running):

```bash
supabase start
```

2. Create a migration for any schema change:

```bash
supabase migration new <short_name>
```

3. Apply migrations locally:

```bash
pnpm db:migrate
```

4. (Optional) Reset and reapply everything from scratch:

```bash
pnpm db:reset
pnpm db:seed
```

5. Regenerate types (if used):

```bash
pnpm db:gen-types
```

6. Verify no drift:

```bash
pnpm db:diff
pnpm db:verify-types
node scripts/doctor.mjs
```

## Apply Migrations To Staging Or Production

1. Ensure the Supabase CLI is linked to the correct project.
2. Push migrations:

```bash
pnpm db:push
```

Notes:
- Never push from an unreviewed branch.
- Verify the target project ref before pushing.

## Drift Signals And What To Do

- `supabase/migrations/` missing or empty: stop and create migrations for all schema changes.
- `supabase/types/database.ts` missing or stale: run `pnpm db:gen-types` and commit updates.
- `supabase/config.toml` missing or `verify_jwt` unknown for Twilio webhooks: restore config before shipping.

The doctor script surfaces these as WARN-level checks:

```bash
node scripts/doctor.mjs
```

## Edge Cases

- Multiple environments:
  - Always confirm which Supabase project is linked before running `pnpm db:push` or `pnpm db:pull`.
  - Never reuse staging links for production.
- Local reset:
  - Use `pnpm db:reset` when local schema and migrations diverge or you need a clean baseline.
- CI drift detection:
  - Add a job that runs `pnpm db:verify-types` and fails the build if types are stale.
  - If CI cannot run a local Supabase instance, generate types against a linked project and compare.

## Related Commands

- `pnpm db:diff` — diff local schema against migrations
- `pnpm db:pull` — pull remote schema into migrations
- `pnpm db:push` — push local migrations to linked project
- `pnpm db:gen-types` — regenerate `supabase/types/database.ts`
- `pnpm db:verify-types` — fail if types are out of date
