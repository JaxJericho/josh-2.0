import { describe, expect, it } from "vitest";

import {
  registerWebsiteUser,
  sendWebsiteOtp,
  verifyWebsiteOtp,
  type RegistrationLifecycleDependencies,
  type RegistrationLifecycleRepository,
} from "../app/lib/registration-lifecycle";

describe("website registration lifecycle", () => {
  it("registers an unverified shell and resolves the open launch region from a WA zip", async () => {
    const harness = createHarness();

    const result = await registerWebsiteUser(buildRegistrationInput({
      zipCode: "98101",
    }), harness.dependencies);

    expect(result.ok).toBe(true);
    expect(result.user.state).toBe("unverified");
    expect(result.region.slug).toBe("us-wa");
    expect(harness.state.users).toHaveLength(1);
    expect(harness.state.users[0]?.phone_e164).toBe("+14155550123");
  });

  it("persists a hashed otp session and sends the real sms body", async () => {
    const harness = createHarness();
    const registration = await registerWebsiteUser(buildRegistrationInput(), harness.dependencies);

    const sendResult = await sendWebsiteOtp({
      userId: registration.user.id,
    }, harness.dependencies);

    expect(sendResult.ok).toBe(true);
    expect(sendResult.otp_session.id).toBe("otp_1");
    expect(harness.state.otpSessions).toHaveLength(1);
    expect(harness.state.otpSessions[0]?.otp_hash).not.toContain("123456");
    expect(harness.state.smsSends).toHaveLength(1);
    expect(harness.state.smsSends[0]?.body).toContain("123456");
    expect(harness.state.smsSends[0]?.purpose).toBe("registration_otp");
  });

  it("verifies otp and activates onboarding immediately for open regions", async () => {
    const harness = createHarness();
    const registration = await registerWebsiteUser(buildRegistrationInput({
      zipCode: "98109",
    }), harness.dependencies);
    const sendResult = await sendWebsiteOtp({
      userId: registration.user.id,
    }, harness.dependencies);

    const verifyResult = await verifyWebsiteOtp({
      userId: registration.user.id,
      otpSessionId: sendResult.otp_session.id,
      code: "123456",
    }, harness.dependencies);

    expect(verifyResult.ok).toBe(true);
    expect(verifyResult.state.user.state).toBe("interviewing");
    expect(verifyResult.state.profile?.id).toBe("profile_1");
    expect(verifyResult.state.conversation_session?.mode).toBe("interviewing");
    expect(verifyResult.state.conversation_session?.state_token).toBe("onboarding:awaiting_opening_response");
    expect(verifyResult.state.waitlist).toBeNull();
    expect(verifyResult.state.next_action).toBe("begin_onboarding");
    expect(harness.state.regionMemberships[0]?.status).toBe("active");
    expect(harness.state.conversationEvents).toHaveLength(1);
    expect(harness.state.smsSends).toHaveLength(2);
    expect(harness.state.smsSends[1]?.purpose).toBe("onboarding_opening");
  });

  it("verifies otp into the waitlist flow without prematurely activating onboarding", async () => {
    const harness = createHarness();
    const registration = await registerWebsiteUser(buildRegistrationInput({
      zipCode: "94107",
    }), harness.dependencies);
    const sendResult = await sendWebsiteOtp({
      userId: registration.user.id,
    }, harness.dependencies);

    const verifyResult = await verifyWebsiteOtp({
      userId: registration.user.id,
      otpSessionId: sendResult.otp_session.id,
      code: "123456",
    }, harness.dependencies);

    expect(verifyResult.state.user.state).toBe("verified");
    expect(verifyResult.state.region?.slug).toBe("waitlist");
    expect(verifyResult.state.waitlist?.status).toBe("waiting");
    expect(verifyResult.state.conversation_session?.mode).toBe("idle");
    expect(verifyResult.state.next_action).toBe("waitlist");
    expect(harness.state.regionMemberships[0]?.status).toBe("waitlisted");
    expect(harness.state.smsSends).toHaveLength(1);
  });

  it("keeps otp verify idempotent on replay after success", async () => {
    const harness = createHarness();
    const registration = await registerWebsiteUser(buildRegistrationInput(), harness.dependencies);
    const sendResult = await sendWebsiteOtp({
      userId: registration.user.id,
    }, harness.dependencies);

    const first = await verifyWebsiteOtp({
      userId: registration.user.id,
      otpSessionId: sendResult.otp_session.id,
      code: "123456",
    }, harness.dependencies);

    const second = await verifyWebsiteOtp({
      userId: registration.user.id,
      otpSessionId: sendResult.otp_session.id,
      code: "123456",
    }, harness.dependencies);

    expect(first.state.user.state).toBe("interviewing");
    expect(second.state.user.state).toBe("interviewing");
    expect(harness.state.smsSends).toHaveLength(2);
    expect(harness.state.conversationEvents).toHaveLength(1);
  });
});

function buildRegistrationInput(overrides: Partial<{
  firstName: string;
  lastName: string;
  countryCode: string;
  phoneNumber: string;
  email: string;
  birthday: string;
  zipCode: string;
}> = {}) {
  return {
    firstName: overrides.firstName ?? "Avery",
    lastName: overrides.lastName ?? "Stone",
    countryCode: overrides.countryCode ?? "+1",
    phoneNumber: overrides.phoneNumber ?? "4155550123",
    email: overrides.email ?? "avery@example.com",
    birthday: overrides.birthday ?? "1990-01-01",
    zipCode: overrides.zipCode ?? "98101",
    smsConsent: true,
    ageConsent: true,
    termsConsent: true,
    privacyConsent: true,
  };
}

function createHarness() {
  const state = {
    users: [] as Array<Record<string, unknown>>,
    otpSessions: [] as Array<Record<string, unknown>>,
    profiles: [] as Array<Record<string, unknown>>,
    profileRegionAssignments: [] as Array<Record<string, unknown>>,
    regionMemberships: [] as Array<Record<string, unknown>>,
    waitlistEntries: [] as Array<Record<string, unknown>>,
    conversationSessions: [] as Array<Record<string, unknown>>,
    conversationEvents: [] as Array<Record<string, unknown>>,
    smsSends: [] as Array<Record<string, unknown>>,
    userSeq: 0,
    otpSeq: 0,
    profileSeq: 0,
    waitlistSeq: 0,
    sessionSeq: 0,
  };

  const regions = [
    {
      id: "region_open_wa",
      slug: "us-wa",
      state: "open",
      name: "Washington",
      display_name: "Washington",
    },
    {
      id: "region_waitlist",
      slug: "waitlist",
      state: "waitlisted",
      name: "Waitlist",
      display_name: "Waitlist",
    },
  ];

  const repository: RegistrationLifecycleRepository = {
    async findUserByPhone(input) {
      return toUserRecord(
        state.users.find((user) =>
          user.phone_e164 === input.phoneE164 || user.phone_hash === input.phoneHash
        ) ?? null,
      );
    },

    async findUserById(userId) {
      return toUserRecord(state.users.find((user) => user.id === userId) ?? null);
    },

    async insertUser(input) {
      state.userSeq += 1;
      const row = {
        id: `user_${state.userSeq}`,
        phone_e164: input.phoneE164,
        phone_hash: input.phoneHash,
        first_name: input.firstName,
        last_name: input.lastName,
        birthday: input.birthday,
        email: input.email,
        state: "unverified",
        sms_consent: input.smsConsent,
        age_consent: input.ageConsent,
        terms_consent: input.termsConsent,
        privacy_consent: input.privacyConsent,
        region_id: input.regionId,
        registration_source: input.registrationSource,
        deleted_at: null,
      };
      state.users.push(row);
      return toUserRecord(row)!;
    },

    async updateUser(userId, patch) {
      const user = state.users.find((entry) => entry.id === userId);
      if (!user) {
        throw new Error("User not found.");
      }
      Object.assign(user, patch);
      return toUserRecord(user)!;
    },

    async findRegionBySlug(slug) {
      return toRegionRecord(regions.find((region) => region.slug === slug) ?? null);
    },

    async findRegionById(regionId) {
      return toRegionRecord(regions.find((region) => region.id === regionId) ?? null);
    },

    async findActiveOtpSessionByUserId(userId) {
      return toOtpRecord(
        [...state.otpSessions].reverse().find((session) =>
          session.user_id === userId && session.verified_at === null
        ) ?? null,
      );
    },

    async findOtpSessionById(otpSessionId) {
      return toOtpRecord(state.otpSessions.find((session) => session.id === otpSessionId) ?? null);
    },

    async createOtpSession(input) {
      state.otpSeq += 1;
      const row = {
        id: `otp_${state.otpSeq}`,
        user_id: input.userId,
        otp_hash: input.otpHash,
        expires_at: input.expiresAtIso,
        verified_at: null,
        attempts: 0,
        updated_at: input.expiresAtIso,
      };
      state.otpSessions.push(row);
      return toOtpRecord(row)!;
    },

    async updateOtpSession(otpSessionId, patch) {
      const session = state.otpSessions.find((entry) => entry.id === otpSessionId);
      if (!session) {
        throw new Error("OTP session not found.");
      }
      Object.assign(session, patch);
      session.updated_at = "2026-03-23T10:00:00.000Z";
      return toOtpRecord(session)!;
    },

    async findProfileByUserId(userId) {
      return toProfileRecord(state.profiles.find((profile) => profile.user_id === userId) ?? null);
    },

    async createProfile(input) {
      state.profileSeq += 1;
      const row = {
        id: `profile_${state.profileSeq}`,
        user_id: input.userId,
        state: "empty",
        country_code: input.countryCode,
        state_code: input.stateCode,
      };
      state.profiles.push(row);
      return toProfileRecord(row)!;
    },

    async updateProfile(profileId, patch) {
      const profile = state.profiles.find((entry) => entry.id === profileId);
      if (!profile) {
        throw new Error("Profile not found.");
      }
      Object.assign(profile, patch);
      return toProfileRecord(profile)!;
    },

    async upsertProfileRegionAssignment(input) {
      const existing = state.profileRegionAssignments.find((entry) => entry.profile_id === input.profileId);
      if (existing) {
        Object.assign(existing, {
          region_id: input.regionId,
          assignment_source: input.assignmentSource,
          assigned_at: input.assignedAtIso,
        });
        return;
      }

      state.profileRegionAssignments.push({
        profile_id: input.profileId,
        region_id: input.regionId,
        assignment_source: input.assignmentSource,
        assigned_at: input.assignedAtIso,
      });
    },

    async upsertRegionMembership(input) {
      const existing = state.regionMemberships.find((entry) =>
        entry.user_id === input.userId && entry.region_id === input.regionId
      );
      if (existing) {
        existing.status = input.status;
        existing.joined_at = input.joinedAtIso;
        return;
      }

      state.regionMemberships.push({
        id: `membership_${state.regionMemberships.length + 1}`,
        user_id: input.userId,
        region_id: input.regionId,
        status: input.status,
        joined_at: input.joinedAtIso,
      });
    },

    async findWaitlistEntryByProfileId(profileId) {
      return toWaitlistRecord(
        state.waitlistEntries.find((entry) => entry.profile_id === profileId) ?? null,
      );
    },

    async upsertWaitlistEntry(input) {
      const existing = state.waitlistEntries.find((entry) => entry.profile_id === input.profileId);
      if (existing) {
        Object.assign(existing, {
          user_id: input.userId,
          region_id: input.regionId,
          status: input.status,
          source: input.source,
          reason: input.reason,
        });
        return;
      }

      state.waitlistSeq += 1;
      state.waitlistEntries.push({
        id: `waitlist_${state.waitlistSeq}`,
        profile_id: input.profileId,
        user_id: input.userId,
        region_id: input.regionId,
        status: input.status,
        source: input.source,
        reason: input.reason,
      });
    },

    async markWaitlistActivated(input) {
      const entry = state.waitlistEntries.find((waitlist) => waitlist.profile_id === input.profileId);
      if (entry) {
        entry.status = "activated";
        entry.activated_at = input.activatedAtIso;
      }
    },

    async findConversationSessionByUserId(userId) {
      return toConversationSessionRecord(
        state.conversationSessions.find((session) => session.user_id === userId) ?? null,
      );
    },

    async createConversationSession(input) {
      state.sessionSeq += 1;
      const row = {
        id: `session_${state.sessionSeq}`,
        user_id: input.userId,
        mode: input.mode,
        state_token: input.stateToken,
        current_step_id: null,
        last_inbound_message_sid: null,
      };
      state.conversationSessions.push(row);
      return toConversationSessionRecord(row)!;
    },

    async updateConversationSession(sessionId, patch) {
      const session = state.conversationSessions.find((entry) => entry.id === sessionId);
      if (!session) {
        throw new Error("Conversation session not found.");
      }
      Object.assign(session, patch);
      return toConversationSessionRecord(session)!;
    },

    async hasConversationEvent(idempotencyKey) {
      return state.conversationEvents.some((event) => event.idempotency_key === idempotencyKey);
    },

    async insertConversationEvent(input) {
      if (state.conversationEvents.some((event) => event.idempotency_key === input.idempotencyKey)) {
        return;
      }
      state.conversationEvents.push({
        conversation_session_id: input.conversationSessionId,
        user_id: input.userId,
        profile_id: input.profileId,
        event_type: input.eventType,
        step_token: input.stepToken,
        idempotency_key: input.idempotencyKey,
        payload: input.payload,
      });
    },
  };

  const dependencies: RegistrationLifecycleDependencies = {
    repository,
    now: () => new Date("2026-03-23T10:00:00.000Z"),
    generateOtpCode: () => "123456",
    sendSmsText: async (input) => {
      state.smsSends.push(input);
    },
  };

  return {
    dependencies,
    state,
  };
}

function toUserRecord(value: Record<string, unknown> | null) {
  return value as {
    id: string;
    phone_e164: string;
    phone_hash: string;
    first_name: string;
    last_name: string;
    birthday: string;
    email: string | null;
    state: string;
    sms_consent: boolean;
    age_consent: boolean;
    terms_consent: boolean;
    privacy_consent: boolean;
    region_id: string | null;
    registration_source: string | null;
    deleted_at: string | null;
  } | null;
}

function toRegionRecord(value: Record<string, unknown> | null) {
  return value as {
    id: string;
    slug: string;
    state: string;
    name: string;
    display_name: string;
  } | null;
}

function toOtpRecord(value: Record<string, unknown> | null) {
  return value as {
    id: string;
    user_id: string;
    otp_hash: string;
    expires_at: string;
    verified_at: string | null;
    attempts: number;
    updated_at: string;
  } | null;
}

function toProfileRecord(value: Record<string, unknown> | null) {
  return value as {
    id: string;
    user_id: string;
    state: string;
    country_code: string | null;
    state_code: string | null;
  } | null;
}

function toConversationSessionRecord(value: Record<string, unknown> | null) {
  return value as {
    id: string;
    user_id: string;
    mode: string;
    state_token: string;
    current_step_id: string | null;
    last_inbound_message_sid: string | null;
  } | null;
}

function toWaitlistRecord(value: Record<string, unknown> | null) {
  return value as {
    id: string;
    profile_id: string;
    region_id: string;
    status: string;
  } | null;
}
