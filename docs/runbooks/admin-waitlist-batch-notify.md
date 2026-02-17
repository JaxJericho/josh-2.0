# Admin Waitlist Batch Notify Runbook

This runbook covers the admin-only waitlist batch endpoint used to:

- Optionally open/activate a region.
- Notify waitlisted users exactly once per profile via outbound queue jobs.

Endpoint:

- `POST https://<project-ref>.supabase.co/functions/v1/admin-waitlist-batch-notify`

## Request Body

```json
{
  "region_slug": "waitlist",
  "limit": 25,
  "dry_run": false,
  "open_region": true,
  "notification_template_version": "v1"
}
```

Fields:

- `region_slug` (required): canonical region slug.
- `limit` (optional): integer clamped to `1..500`, default `50`.
- `dry_run` (optional): boolean, default `false`.
- `open_region` (optional): boolean, default `false`.
- `notification_template_version` (optional): currently supports `v1`; default `v1`.

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
  - claimed rows are transitioned to `status='notified'` with `last_notified_at=now()`
- Outbound queue uses deterministic idempotency key:
  - `region_launch_notify:{region_id}:{profile_id}:{template_version}`

Re-running with the same region after a successful run should produce `claimed_count=0` and `sent_count=0`.

## Example Calls

Dry run:

```bash
curl -sS -X POST \
  "https://<project-ref>.supabase.co/functions/v1/admin-waitlist-batch-notify" \
  -H "content-type: application/json" \
  -H "x-admin-secret: <QSTASH_RUNNER_SECRET>" \
  --data '{"region_slug":"waitlist","limit":2,"dry_run":true,"open_region":false,"notification_template_version":"v1"}'
```

Live run:

```bash
curl -sS -X POST \
  "https://<project-ref>.supabase.co/functions/v1/admin-waitlist-batch-notify" \
  -H "content-type: application/json" \
  -H "x-admin-secret: <QSTASH_RUNNER_SECRET>" \
  --data '{"region_slug":"waitlist","limit":2,"dry_run":false,"open_region":true,"notification_template_version":"v1"}'
```

Replay run (same params, should not send duplicates):

```bash
curl -sS -X POST \
  "https://<project-ref>.supabase.co/functions/v1/admin-waitlist-batch-notify" \
  -H "content-type: application/json" \
  -H "x-admin-secret: <QSTASH_RUNNER_SECRET>" \
  --data '{"region_slug":"waitlist","limit":2,"dry_run":false,"open_region":true,"notification_template_version":"v1"}'
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
