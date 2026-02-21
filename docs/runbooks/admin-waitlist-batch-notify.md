# Admin Waitlist Batch Notify Runbook

This runbook covers the admin-only waitlist batch endpoint used to:

- Optionally open/activate a region.
- Activate waitlisted users exactly once per profile into the onboarding opening path.

Endpoint:

- `POST https://<project-ref>.supabase.co/functions/v1/admin-waitlist-batch-notify`

## Request Body

```json
{
  "region_slug": "waitlist",
  "limit": 25,
  "dry_run": false,
  "open_region": true,
  "notification_template_version": "onboarding_opening"
}
```

Fields:

- `region_slug` (required): canonical region slug.
- `limit` (optional): integer clamped to `1..500`, default `50`.
- `dry_run` (optional): boolean, default `false`.
- `open_region` (optional): boolean, default `false`.
- `notification_template_version` (optional): supports `onboarding_opening`; default `onboarding_opening`.

## Auth (Admin-Only)

Use one of:

- `x-admin-secret: <QSTASH_RUNNER_SECRET>` (timing-safe compare inside function), or
- `Authorization: Bearer <admin-user-jwt>` where JWT user must pass `public.is_admin_user()`.

At least one auth method is required or the endpoint returns `401`.

## Response Summary

The endpoint returns structured JSON:

- `region_slug`
- `open_region_applied`
- `dry_run`
- `selected_count`
- `claimed_count`
- `attempted_send_count`
- `sent_count`
- `skipped_already_notified_count`
- `errors` (redacted array)

## Idempotency + Replay Safety

- Selection only includes entries where:
  - status is eligible (`waiting` or `onboarded`)
  - `last_notified_at IS NULL`
- Claim uses compare-and-set semantics:
  - update only rows that still have `last_notified_at IS NULL`
  - claimed rows are transitioned to `status='activated'` with `last_notified_at=now()`
- Activation uses deterministic idempotency key:
  - `waitlist_activation_onboarding:{region_id}:{profile_id}:onboarding_opening`
- Activation path calls onboarding engine start and sends `ONBOARDING_OPENING` first.

Re-running with the same region after a successful run should produce `claimed_count=0` and `sent_count=0`.

## Example Calls

Dry run:

```bash
curl -sS -X POST \
  "https://<project-ref>.supabase.co/functions/v1/admin-waitlist-batch-notify" \
  -H "content-type: application/json" \
  -H "x-admin-secret: <QSTASH_RUNNER_SECRET>" \
  --data '{"region_slug":"waitlist","limit":2,"dry_run":true,"open_region":false,"notification_template_version":"onboarding_opening"}'
```

Live run:

```bash
curl -sS -X POST \
  "https://<project-ref>.supabase.co/functions/v1/admin-waitlist-batch-notify" \
  -H "content-type: application/json" \
  -H "x-admin-secret: <QSTASH_RUNNER_SECRET>" \
  --data '{"region_slug":"waitlist","limit":2,"dry_run":false,"open_region":true,"notification_template_version":"onboarding_opening"}'
```

Replay run (same params, should not send duplicates):

```bash
curl -sS -X POST \
  "https://<project-ref>.supabase.co/functions/v1/admin-waitlist-batch-notify" \
  -H "content-type: application/json" \
  -H "x-admin-secret: <QSTASH_RUNNER_SECRET>" \
  --data '{"region_slug":"waitlist","limit":2,"dry_run":false,"open_region":true,"notification_template_version":"onboarding_opening"}'
```

## SQL Verification Snippets

```sql
select count(*) from public.waitlist_entries
where region_id = (select id from public.regions where slug = '<region_slug>')
  and last_notified_at is not null;
```

```sql
select profile_id, count(*) from public.waitlist_entries
group by profile_id having count(*) > 1;
```

Run the first query before and after replay to confirm the notified set size does not increase.
