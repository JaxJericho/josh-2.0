import { describe, expect, it } from "vitest";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { runDefaultEngine } from "../../supabase/functions/_shared/engines/default-engine";
import {
  WAITLIST_CONFIRMATION_MESSAGE,
  WAITLIST_FOLLOWUP_MESSAGE,
} from "../../supabase/functions/_shared/waitlist/waitlist-operations";

type WaitlistEntryRow = {
  profile_id: string;
  user_id: string;
  region_id: string;
  status: string;
  source: string;
  reason: string;
  updated_at: string;
  last_notified_at?: string;
  notified_at?: string;
};

describe("default engine waitlist gating", () => {
  it("creates one waitlist row and sends confirmation once under replay", async () => {
    const state = createState({
      isLaunchRegion: false,
      regionSlug: "waitlist",
      regionId: "reg_waitlist",
    });

    const first = await runDefaultEngine({
      supabase: buildSupabaseMock(state),
      decision: decisionFor(state.userId),
      payload: payloadStub(),
    });

    const second = await runDefaultEngine({
      supabase: buildSupabaseMock(state),
      decision: decisionFor(state.userId),
      payload: payloadStub(),
    });

    expect(first.reply_message).toBe(WAITLIST_CONFIRMATION_MESSAGE);
    expect(second.reply_message).toBe(WAITLIST_FOLLOWUP_MESSAGE);
    expect(Object.keys(state.waitlistEntries).length).toBe(1);
    expect(state.waitlistEntries[state.profileId]?.status).toBe("notified");
    expect(state.waitlistEntries[state.profileId]?.last_notified_at).toBeTruthy();
  });

  it("does not create waitlist entries for active launch region", async () => {
    const state = createState({
      isLaunchRegion: true,
      regionSlug: "us-wa",
      regionId: "reg_us_wa",
    });

    const result = await runDefaultEngine({
      supabase: buildSupabaseMock(state),
      decision: decisionFor(state.userId),
      payload: payloadStub(),
    });

    expect(result.reply_message).toContain("default engine selected");
    expect(Object.keys(state.waitlistEntries).length).toBe(0);
  });

  it("respects waitlist_override and skips waitlist insertion", async () => {
    const state = createState({
      isLaunchRegion: false,
      regionSlug: "waitlist",
      regionId: "reg_waitlist",
      profileEntitlements: {
        can_initiate: true,
        can_participate: false,
        can_exchange_contact: false,
        region_override: false,
        waitlist_override: true,
        safety_override: false,
        reason: "manual override",
      },
    });

    const result = await runDefaultEngine({
      supabase: buildSupabaseMock(state),
      decision: decisionFor(state.userId),
      payload: payloadStub(),
    });

    expect(result.reply_message).toContain("default engine selected");
    expect(Object.keys(state.waitlistEntries)).toHaveLength(0);
  });
});

function createState(params: {
  isLaunchRegion: boolean;
  regionSlug: string;
  regionId: string;
  profileEntitlements?: {
    can_initiate: boolean;
    can_participate: boolean;
    can_exchange_contact: boolean;
    region_override: boolean;
    waitlist_override: boolean;
    safety_override: boolean;
    reason: string | null;
  };
  hasActiveSafetyHold?: boolean;
}) {
  return {
    userId: "usr_waitlist_1",
    profileId: "pro_waitlist_1",
    regionAssignment: {
      region_id: params.regionId,
      regions: {
        id: params.regionId,
        slug: params.regionSlug,
        is_active: params.isLaunchRegion,
        is_launch_region: params.isLaunchRegion,
      },
    },
    profileEntitlements: params.profileEntitlements ?? null,
    hasActiveSafetyHold: params.hasActiveSafetyHold ?? false,
    waitlistEntries: {} as Record<string, WaitlistEntryRow>,
  };
}

function buildSupabaseMock(state: {
  userId: string;
  profileId: string;
  regionAssignment: {
    region_id: string;
    regions: {
      id: string;
      slug: string;
      is_active: boolean;
      is_launch_region: boolean;
    };
  } | null;
  profileEntitlements: {
    can_initiate: boolean;
    can_participate: boolean;
    can_exchange_contact: boolean;
    region_override: boolean;
    waitlist_override: boolean;
    safety_override: boolean;
    reason: string | null;
  } | null;
  hasActiveSafetyHold: boolean;
  waitlistEntries: Record<string, WaitlistEntryRow>;
}) {
  return {
    from(table: string) {
      const queryState: Record<string, unknown> = {};

      const query = {
        select() {
          return query;
        },
        eq(column: string, value: unknown) {
          queryState[column] = value;
          return query;
        },
        async maybeSingle() {
          if (table === "profiles") {
            const userId = queryState.user_id as string;
            const profileId = queryState.id as string;
            if (userId && userId !== state.userId) {
              return { data: null, error: null };
            }
            if (profileId && profileId !== state.profileId) {
              return { data: null, error: null };
            }
            return {
              data: {
                id: state.profileId,
                user_id: state.userId,
              },
              error: null,
            };
          }

          if (table === "profile_region_assignments") {
            const profileId = queryState.profile_id as string;
            if (!state.regionAssignment || profileId !== state.profileId) {
              return { data: null, error: null };
            }
            return {
              data: state.regionAssignment,
              error: null,
            };
          }

          if (table === "waitlist_entries") {
            const profileId = queryState.profile_id as string;
            return {
              data: state.waitlistEntries[profileId] ?? null,
              error: null,
            };
          }

          if (table === "profile_entitlements") {
            const profileId = queryState.profile_id as string;
            if (profileId !== state.profileId || !state.profileEntitlements) {
              return { data: null, error: null };
            }
            return {
              data: state.profileEntitlements,
              error: null,
            };
          }

          if (table === "safety_holds") {
            return {
              data: state.hasActiveSafetyHold ? { id: "hold_1" } : null,
              error: null,
            };
          }

          return { data: null, error: null };
        },
        upsert(payload: Record<string, unknown>) {
          if (table === "waitlist_entries") {
            const profileId = payload.profile_id as string;
            const existing = state.waitlistEntries[profileId] ?? null;
            state.waitlistEntries[profileId] = {
              ...(existing ?? {}),
              ...payload,
            } as WaitlistEntryRow;
          }

          return Promise.resolve({ error: null });
        },
      };

      return query;
    },
  };
}

function decisionFor(userId: string) {
  return {
    user_id: userId,
    state: {
      mode: "idle" as const,
      state_token: "idle",
    },
    profile_is_complete_mvp: null,
    route: "default_engine" as const,
    safety_override_applied: false,
    next_transition: "idle:awaiting_user_input",
  };
}

function payloadStub() {
  return {
    inbound_message_id: "msg_waitlist_1",
    inbound_message_sid: "SM_WAITLIST_1",
    from_e164: "+15550000001",
    to_e164: "+15551112222",
    body_raw: "hello",
    body_normalized: "HELLO",
  };
}
