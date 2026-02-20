# E2E Staging Checklist

## Scenario 1 - New User Onboarding Burst (QStash)

### Goal
Validate onboarding delivery via the Phase 8B QStash sequential scheduler (not `sms_outbound_jobs` burst seeding).

### Preconditions
- Test user/profile/waitlist anchors exist for the harness fixtures.
- `pnpm run doctor` passes.
- Harness mode is explicit (`HARNESS_QSTASH_MODE=stub` or `HARNESS_QSTASH_MODE=real`).

### Entry Path (must match production)
1. Trigger onboarding through waitlist activation path (`admin-waitlist-batch-notify`).
2. Confirm opening message is sent directly.
3. Send affirmative inbound at opening gate (`START`) and explanation gate (`YES`).

### Assertions (all modes)
- `state_token` transitions include `onboarding:awaiting_burst` after explanation affirmative.
- Burst messages are observed in order: `onboarding_message_1` -> `onboarding_message_2` -> `onboarding_message_3` -> `onboarding_message_4`.
- Burst step rows are present in `sms_messages` with:
  - `correlation_id = onboarding:{profile_id}:{session_id}:{step_id}`
  - non-null Twilio SID
- Zero burst rows are created in `sms_outbound_jobs` for purposes:
  - `onboarding_onboarding_message_1`
  - `onboarding_onboarding_message_2`
  - `onboarding_onboarding_message_3`
  - `onboarding_onboarding_message_4`
- Idempotency check passes: duplicate step payload submission results in exactly one delivered `sms_messages` row for that correlation id.

### Real Mode Timing Assertions
- Poll each burst step row up to 60 seconds.
- Enforce minimum gaps:
  - `message_2 - message_1 >= 6s`
  - `message_3 - message_2 >= 6s`

### Commands
- Stub mode:
  - `HARNESS_QSTASH_MODE=stub pnpm staging:onboarding:e2e`
- Real mode:
  - `HARNESS_QSTASH_MODE=real pnpm staging:onboarding:e2e`
- Repeatability (no state bleed):
  - run the same command twice back-to-back and confirm identical pass assertions.
