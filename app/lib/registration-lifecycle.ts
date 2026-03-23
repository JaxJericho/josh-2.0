import crypto from "crypto";

import { startOnboardingForUser } from "../../packages/core/src/onboarding/onboarding-engine";
import { resolveRegionAssignment } from "../../packages/core/src/regions/assignment";
import { createServiceRoleDbClient } from "../../packages/db/src/client-node.mjs";
import { encryptSmsBody } from "../../packages/db/src/queries/crypto";
import {
  createNodeEnvReader,
  resolveTwilioRuntimeFromEnv,
} from "../../packages/messaging/src/client";
import { sendSms } from "../../packages/messaging/src/sender";

const OTP_LENGTH = 6;
const OTP_EXPIRY_MINUTES = 10;
const OTP_RESEND_COOLDOWN_SECONDS = 30;
const MAX_OTP_ATTEMPTS = 5;
const WEBSITE_REGISTRATION_SOURCE = "website";
const ONBOARDING_OPENING_EVENT_IDEMPOTENCY_PREFIX = "onboarding:event:opening:";
const ONBOARDING_OPENING_SEND_IDEMPOTENCY_PREFIX = "onboarding:opening:";

type JsonRecord = Record<string, unknown>;

export type RegisterWebsiteUserInput = {
  firstName: string;
  lastName: string;
  countryCode: string;
  phoneNumber: string;
  email?: string | null;
  birthday: string;
  zipCode: string;
  smsConsent: boolean;
  ageConsent: boolean;
  termsConsent: boolean;
  privacyConsent: boolean;
};

export type SendWebsiteOtpInput = {
  userId: string;
};

export type VerifyWebsiteOtpInput = {
  userId: string;
  otpSessionId: string;
  code: string;
};

type UserRecord = {
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
};

type RegionRecord = {
  id: string;
  slug: string;
  state: string;
  name: string;
  display_name: string;
};

type OtpSessionRecord = {
  id: string;
  user_id: string;
  otp_hash: string;
  expires_at: string;
  verified_at: string | null;
  attempts: number;
  updated_at: string;
};

type ProfileRecord = {
  id: string;
  user_id: string;
  state: string;
  country_code: string | null;
  state_code: string | null;
};

type ConversationSessionRecord = {
  id: string;
  user_id: string;
  mode: string;
  state_token: string;
  current_step_id: string | null;
  last_inbound_message_sid: string | null;
};

type WaitlistEntryRecord = {
  id: string;
  profile_id: string;
  region_id: string;
  status: string;
};

type RegistrationStateResponse = {
  user: {
    id: string;
    state: string;
    phone_e164: string;
    first_name: string;
    last_name: string;
    birthday: string;
    email: string | null;
  };
  profile: {
    id: string;
    state: string;
    country_code: string | null;
    state_code: string | null;
  } | null;
  conversation_session: {
    id: string;
    mode: string;
    state_token: string;
    current_step_id: string | null;
  } | null;
  region: {
    id: string;
    slug: string;
    state: string;
    name: string;
  } | null;
  waitlist: {
    id: string;
    status: string;
    region_id: string;
  } | null;
  next_action: "begin_onboarding" | "waitlist";
};

export type RegisterWebsiteUserResult = {
  ok: true;
  user: {
    id: string;
    state: string;
    phone_e164: string;
  };
  region: {
    id: string;
    slug: string;
    state: string;
    name: string;
  };
};

export type SendWebsiteOtpResult = {
  ok: true;
  otp_session: {
    id: string;
    expires_at: string;
  };
  resend_available_in_seconds: number;
};

export type VerifyWebsiteOtpResult = {
  ok: true;
  state: RegistrationStateResponse;
};

type LocationResolution = {
  normalizedZip: string | null;
  countryCode: string | null;
  stateCode: string | null;
};

type SendSmsTextInput = {
  userId: string;
  toE164: string;
  body: string;
  purpose: string;
  idempotencyKey: string;
  correlationId: string;
};

export type RegistrationLifecycleRepository = {
  findUserByPhone: (input: {
    phoneE164: string;
    phoneHash: string;
  }) => Promise<UserRecord | null>;
  findUserById: (userId: string) => Promise<UserRecord | null>;
  insertUser: (input: {
    phoneE164: string;
    phoneHash: string;
    firstName: string;
    lastName: string;
    birthday: string;
    email: string | null;
    regionId: string;
    smsConsent: boolean;
    ageConsent: boolean;
    termsConsent: boolean;
    privacyConsent: boolean;
    registrationSource: string;
  }) => Promise<UserRecord>;
  updateUser: (
    userId: string,
    patch: Partial<{
      first_name: string;
      last_name: string;
      birthday: string;
      email: string | null;
      region_id: string;
      sms_consent: boolean;
      age_consent: boolean;
      terms_consent: boolean;
      privacy_consent: boolean;
      registration_source: string;
      state: string;
    }>,
  ) => Promise<UserRecord>;
  findRegionBySlug: (slug: string) => Promise<RegionRecord | null>;
  findRegionById: (regionId: string) => Promise<RegionRecord | null>;
  findActiveOtpSessionByUserId: (userId: string) => Promise<OtpSessionRecord | null>;
  findOtpSessionById: (otpSessionId: string) => Promise<OtpSessionRecord | null>;
  createOtpSession: (input: {
    userId: string;
    otpHash: string;
    expiresAtIso: string;
  }) => Promise<OtpSessionRecord>;
  updateOtpSession: (
    otpSessionId: string,
    patch: Partial<{
      otp_hash: string;
      expires_at: string;
      verified_at: string | null;
      attempts: number;
    }>,
  ) => Promise<OtpSessionRecord>;
  findProfileByUserId: (userId: string) => Promise<ProfileRecord | null>;
  createProfile: (input: {
    userId: string;
    countryCode: string | null;
    stateCode: string | null;
  }) => Promise<ProfileRecord>;
  updateProfile: (
    profileId: string,
    patch: Partial<{
      country_code: string | null;
      state_code: string | null;
      status_reason: string | null;
    }>,
  ) => Promise<ProfileRecord>;
  upsertProfileRegionAssignment: (input: {
    profileId: string;
    regionId: string;
    assignmentSource: string;
    assignedAtIso: string;
  }) => Promise<void>;
  upsertRegionMembership: (input: {
    userId: string;
    regionId: string;
    status: "active" | "waitlisted";
    joinedAtIso: string;
  }) => Promise<void>;
  findWaitlistEntryByProfileId: (profileId: string) => Promise<WaitlistEntryRecord | null>;
  upsertWaitlistEntry: (input: {
    profileId: string;
    userId: string;
    regionId: string;
    status: string;
    source: string;
    reason: string;
  }) => Promise<void>;
  markWaitlistActivated: (input: {
    profileId: string;
    activatedAtIso: string;
  }) => Promise<void>;
  findConversationSessionByUserId: (userId: string) => Promise<ConversationSessionRecord | null>;
  createConversationSession: (input: {
    userId: string;
    mode: string;
    stateToken: string;
  }) => Promise<ConversationSessionRecord>;
  updateConversationSession: (
    sessionId: string,
    patch: Partial<{
      mode: string;
      state_token: string;
      current_step_id: string | null;
      last_inbound_message_sid: string | null;
    }>,
  ) => Promise<ConversationSessionRecord>;
  hasConversationEvent: (idempotencyKey: string) => Promise<boolean>;
  insertConversationEvent: (input: {
    conversationSessionId: string;
    userId: string;
    profileId: string;
    eventType: string;
    stepToken: string;
    idempotencyKey: string;
    payload: JsonRecord;
  }) => Promise<void>;
};

export type RegistrationLifecycleDependencies = {
  repository: RegistrationLifecycleRepository;
  now: () => Date;
  generateOtpCode: () => string;
  sendSmsText: (input: SendSmsTextInput) => Promise<void>;
};

class RegistrationLifecycleError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "RegistrationLifecycleError";
    this.status = status;
    this.code = code;
  }
}

let cachedDependencies: RegistrationLifecycleDependencies | null = null;
let cachedServiceRoleClient: ReturnType<typeof createServiceRoleDbClient> | null = null;

export async function registerWebsiteUser(
  input: RegisterWebsiteUserInput,
  dependencies: RegistrationLifecycleDependencies = getDefaultRegistrationLifecycleDependencies(),
): Promise<RegisterWebsiteUserResult> {
  const parsed = validateRegisterInput(input);
  const phoneE164 = normalizePhoneToE164(`${parsed.countryCode}${parsed.phoneNumber}`);
  const phoneHash = sha256Hex(phoneE164);
  const location = resolveLocationFromZip(parsed.zipCode);
  const resolvedRegion = resolveRegionAssignment({
    countryCode: location.countryCode,
    stateCode: location.stateCode,
  });
  const region = await requireRegionBySlug(dependencies.repository, resolvedRegion.region_slug);
  const existingUser = await dependencies.repository.findUserByPhone({
    phoneE164,
    phoneHash,
  });

  if (existingUser?.deleted_at) {
    throw new RegistrationLifecycleError(
      409,
      "ACCOUNT_UNAVAILABLE",
      "This phone number cannot be registered.",
    );
  }

  if (existingUser && existingUser.state !== "unverified") {
    throw new RegistrationLifecycleError(
      409,
      "PHONE_ALREADY_VERIFIED",
      "This phone number is already registered. Please log in instead.",
    );
  }

  const user = existingUser
    ? await dependencies.repository.updateUser(existingUser.id, {
      first_name: parsed.firstName,
      last_name: parsed.lastName,
      birthday: parsed.birthday,
      email: parsed.email,
      region_id: region.id,
      sms_consent: parsed.smsConsent,
      age_consent: parsed.ageConsent,
      terms_consent: parsed.termsConsent,
      privacy_consent: parsed.privacyConsent,
      registration_source: WEBSITE_REGISTRATION_SOURCE,
    })
    : await dependencies.repository.insertUser({
      phoneE164,
      phoneHash,
      firstName: parsed.firstName,
      lastName: parsed.lastName,
      birthday: parsed.birthday,
      email: parsed.email,
      regionId: region.id,
      smsConsent: parsed.smsConsent,
      ageConsent: parsed.ageConsent,
      termsConsent: parsed.termsConsent,
      privacyConsent: parsed.privacyConsent,
      registrationSource: WEBSITE_REGISTRATION_SOURCE,
    });

  return {
    ok: true,
    user: {
      id: user.id,
      state: user.state,
      phone_e164: user.phone_e164,
    },
    region: {
      id: region.id,
      slug: region.slug,
      state: region.state,
      name: region.name,
    },
  };
}

export async function sendWebsiteOtp(
  input: SendWebsiteOtpInput,
  dependencies: RegistrationLifecycleDependencies = getDefaultRegistrationLifecycleDependencies(),
): Promise<SendWebsiteOtpResult> {
  const parsed = validateSendOtpInput(input);
  const user = await requireUserById(dependencies.repository, parsed.userId);

  if (user.state !== "unverified") {
    throw new RegistrationLifecycleError(
      409,
      "OTP_SEND_NOT_ALLOWED",
      "This account is no longer awaiting phone verification.",
    );
  }

  const otpCode = dependencies.generateOtpCode();
  const otpHash = hashOtpCode(otpCode);
  const expiresAtIso = addMinutes(dependencies.now(), OTP_EXPIRY_MINUTES).toISOString();
  const activeSession = await dependencies.repository.findActiveOtpSessionByUserId(user.id);
  const otpSession = activeSession
    ? await dependencies.repository.updateOtpSession(activeSession.id, {
      otp_hash: otpHash,
      expires_at: expiresAtIso,
      attempts: 0,
      verified_at: null,
    })
    : await dependencies.repository.createOtpSession({
      userId: user.id,
      otpHash,
      expiresAtIso,
    });

  await dependencies.sendSmsText({
    userId: user.id,
    toE164: user.phone_e164,
    body: buildRegistrationOtpMessage(otpCode),
    purpose: "registration_otp",
    idempotencyKey: `registration:otp:${otpSession.id}:${otpSession.updated_at}`,
    correlationId: otpSession.id,
  });

  return {
    ok: true,
    otp_session: {
      id: otpSession.id,
      expires_at: otpSession.expires_at,
    },
    resend_available_in_seconds: OTP_RESEND_COOLDOWN_SECONDS,
  };
}

export async function verifyWebsiteOtp(
  input: VerifyWebsiteOtpInput,
  dependencies: RegistrationLifecycleDependencies = getDefaultRegistrationLifecycleDependencies(),
): Promise<VerifyWebsiteOtpResult> {
  const parsed = validateVerifyOtpInput(input);
  const user = await requireUserById(dependencies.repository, parsed.userId);
  const otpSession = await requireOtpSessionById(dependencies.repository, parsed.otpSessionId);

  if (otpSession.user_id !== user.id) {
    throw new RegistrationLifecycleError(404, "OTP_SESSION_NOT_FOUND", "OTP session not found.");
  }

  if (!otpSession.verified_at) {
    if (isOtpSessionExpired(otpSession, dependencies.now())) {
      throw new RegistrationLifecycleError(
        400,
        "OTP_EXPIRED",
        "This code has expired. Please request a new code.",
      );
    }

    if (otpSession.attempts >= MAX_OTP_ATTEMPTS) {
      throw new RegistrationLifecycleError(
        429,
        "OTP_ATTEMPTS_EXCEEDED",
        "Too many attempts. Please request a new code.",
      );
    }

    if (!verifyOtpCode(parsed.code, otpSession.otp_hash)) {
      const nextAttempts = otpSession.attempts + 1;
      await dependencies.repository.updateOtpSession(otpSession.id, {
        attempts: nextAttempts,
      });

      throw new RegistrationLifecycleError(
        nextAttempts >= MAX_OTP_ATTEMPTS ? 429 : 400,
        nextAttempts >= MAX_OTP_ATTEMPTS ? "OTP_ATTEMPTS_EXCEEDED" : "OTP_INVALID",
        nextAttempts >= MAX_OTP_ATTEMPTS
          ? "Too many attempts. Please request a new code."
          : "That code is incorrect. Please try again.",
      );
    }

    await dependencies.repository.updateOtpSession(otpSession.id, {
      verified_at: dependencies.now().toISOString(),
    });
  }

  const state = await ensureVerifiedLifecycle(user.id, dependencies);

  return {
    ok: true,
    state,
  };
}

export async function handleRegisterWebsiteUserRequest(
  request: Request,
  dependencies: RegistrationLifecycleDependencies = getDefaultRegistrationLifecycleDependencies(),
): Promise<Response> {
  try {
    const input = await request.json() as RegisterWebsiteUserInput;
    const result = await registerWebsiteUser(input, dependencies);
    return jsonResponse(result, 200);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function handleSendWebsiteOtpRequest(
  request: Request,
  dependencies: RegistrationLifecycleDependencies = getDefaultRegistrationLifecycleDependencies(),
): Promise<Response> {
  try {
    const input = await request.json() as SendWebsiteOtpInput;
    const result = await sendWebsiteOtp(input, dependencies);
    return jsonResponse(result, 200);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function handleVerifyWebsiteOtpRequest(
  request: Request,
  dependencies: RegistrationLifecycleDependencies = getDefaultRegistrationLifecycleDependencies(),
): Promise<Response> {
  try {
    const input = await request.json() as VerifyWebsiteOtpInput;
    const result = await verifyWebsiteOtp(input, dependencies);
    return jsonResponse(result, 200);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export function getDefaultRegistrationLifecycleDependencies(): RegistrationLifecycleDependencies {
  if (!cachedDependencies) {
    cachedDependencies = {
      repository: createSupabaseRegistrationLifecycleRepository(),
      now: () => new Date(),
      generateOtpCode: () => {
        const value = crypto.randomInt(0, 10 ** OTP_LENGTH);
        return value.toString().padStart(OTP_LENGTH, "0");
      },
      sendSmsText: createDefaultSendSmsText(),
    };
  }

  return cachedDependencies;
}

function createSupabaseRegistrationLifecycleRepository(): RegistrationLifecycleRepository {
  const supabase = getServiceRoleClient();

  return {
    async findUserByPhone(input) {
      const { data: byPhone, error: byPhoneError } = await supabase
        .from("users")
        .select(USER_SELECT)
        .eq("phone_e164", input.phoneE164)
        .maybeSingle();

      if (byPhoneError) {
        throw new Error("Unable to load user by phone.");
      }
      if (isUserRow(byPhone)) {
        return byPhone;
      }

      const { data: byHash, error: byHashError } = await supabase
        .from("users")
        .select(USER_SELECT)
        .eq("phone_hash", input.phoneHash)
        .maybeSingle();

      if (byHashError) {
        throw new Error("Unable to load user by phone hash.");
      }

      return isUserRow(byHash) ? byHash : null;
    },

    async findUserById(userId) {
      const { data, error } = await supabase
        .from("users")
        .select(USER_SELECT)
        .eq("id", userId)
        .maybeSingle();

      if (error) {
        throw new Error("Unable to load user.");
      }

      return isUserRow(data) ? data : null;
    },

    async insertUser(input) {
      const { data, error } = await supabase
        .from("users")
        .insert({
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
        })
        .select(USER_SELECT)
        .single();

      if (error || !isUserRow(data)) {
        throw new Error("Unable to create registration user.");
      }

      return data;
    },

    async updateUser(userId, patch) {
      const { data, error } = await supabase
        .from("users")
        .update(patch)
        .eq("id", userId)
        .select(USER_SELECT)
        .single();

      if (error || !isUserRow(data)) {
        throw new Error("Unable to update registration user.");
      }

      return data;
    },

    async findRegionBySlug(slug) {
      const { data, error } = await supabase
        .from("regions")
        .select(REGION_SELECT)
        .eq("slug", slug)
        .maybeSingle();

      if (error) {
        throw new Error("Unable to load region by slug.");
      }

      return isRegionRow(data) ? data : null;
    },

    async findRegionById(regionId) {
      const { data, error } = await supabase
        .from("regions")
        .select(REGION_SELECT)
        .eq("id", regionId)
        .maybeSingle();

      if (error) {
        throw new Error("Unable to load region.");
      }

      return isRegionRow(data) ? data : null;
    },

    async findActiveOtpSessionByUserId(userId) {
      const { data, error } = await supabase
        .from("otp_sessions")
        .select(OTP_SESSION_SELECT)
        .eq("user_id", userId)
        .is("verified_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        throw new Error("Unable to load active OTP session.");
      }

      return isOtpSessionRow(data) ? data : null;
    },

    async findOtpSessionById(otpSessionId) {
      const { data, error } = await supabase
        .from("otp_sessions")
        .select(OTP_SESSION_SELECT)
        .eq("id", otpSessionId)
        .maybeSingle();

      if (error) {
        throw new Error("Unable to load OTP session.");
      }

      return isOtpSessionRow(data) ? data : null;
    },

    async createOtpSession(input) {
      const { data, error } = await supabase
        .from("otp_sessions")
        .insert({
          user_id: input.userId,
          otp_hash: input.otpHash,
          expires_at: input.expiresAtIso,
          attempts: 0,
        })
        .select(OTP_SESSION_SELECT)
        .single();

      if (error || !isOtpSessionRow(data)) {
        throw new Error("Unable to create OTP session.");
      }

      return data;
    },

    async updateOtpSession(otpSessionId, patch) {
      const { data, error } = await supabase
        .from("otp_sessions")
        .update(patch)
        .eq("id", otpSessionId)
        .select(OTP_SESSION_SELECT)
        .single();

      if (error || !isOtpSessionRow(data)) {
        throw new Error("Unable to update OTP session.");
      }

      return data;
    },

    async findProfileByUserId(userId) {
      const { data, error } = await supabase
        .from("profiles")
        .select(PROFILE_SELECT)
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        throw new Error("Unable to load profile.");
      }

      return isProfileRow(data) ? data : null;
    },

    async createProfile(input) {
      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from("profiles")
        .insert({
          user_id: input.userId,
          state: "empty",
          is_complete_mvp: false,
          preferences: {},
          coordination_dimensions: {},
          activity_patterns: [],
          boundaries: {},
          active_intent: null,
          completeness_percent: 0,
          last_interview_step: null,
          completed_at: null,
          country_code: input.countryCode,
          state_code: input.stateCode,
          status_reason: "registration_verified",
          state_changed_at: nowIso,
        })
        .select(PROFILE_SELECT)
        .single();

      if (error || !isProfileRow(data)) {
        throw new Error("Unable to create profile.");
      }

      return data;
    },

    async updateProfile(profileId, patch) {
      const { data, error } = await supabase
        .from("profiles")
        .update(patch)
        .eq("id", profileId)
        .select(PROFILE_SELECT)
        .single();

      if (error || !isProfileRow(data)) {
        throw new Error("Unable to update profile.");
      }

      return data;
    },

    async upsertProfileRegionAssignment(input) {
      const { error } = await supabase
        .from("profile_region_assignments")
        .upsert(
          {
            profile_id: input.profileId,
            region_id: input.regionId,
            assignment_source: input.assignmentSource,
            assigned_at: input.assignedAtIso,
          },
          { onConflict: "profile_id" },
        );

      if (error) {
        throw new Error("Unable to upsert profile region assignment.");
      }
    },

    async upsertRegionMembership(input) {
      const { error } = await supabase
        .from("region_memberships")
        .upsert(
          {
            user_id: input.userId,
            region_id: input.regionId,
            status: input.status,
            joined_at: input.joinedAtIso,
            released_at: null,
          },
          { onConflict: "user_id,region_id" },
        );

      if (error) {
        throw new Error("Unable to upsert region membership.");
      }
    },

    async findWaitlistEntryByProfileId(profileId) {
      const { data, error } = await supabase
        .from("waitlist_entries")
        .select(WAITLIST_SELECT)
        .eq("profile_id", profileId)
        .maybeSingle();

      if (error) {
        throw new Error("Unable to load waitlist entry.");
      }

      return isWaitlistRow(data) ? data : null;
    },

    async upsertWaitlistEntry(input) {
      const { error } = await supabase
        .from("waitlist_entries")
        .upsert(
          {
            profile_id: input.profileId,
            user_id: input.userId,
            region_id: input.regionId,
            status: input.status,
            source: input.source,
            reason: input.reason,
          },
          { onConflict: "profile_id" },
        );

      if (error) {
        throw new Error("Unable to upsert waitlist entry.");
      }
    },

    async markWaitlistActivated(input) {
      const { error } = await supabase
        .from("waitlist_entries")
        .update({
          status: "activated",
          activated_at: input.activatedAtIso,
          onboarded_at: input.activatedAtIso,
        })
        .eq("profile_id", input.profileId);

      if (error) {
        throw new Error("Unable to activate waitlist entry.");
      }
    },

    async findConversationSessionByUserId(userId) {
      const { data, error } = await supabase
        .from("conversation_sessions")
        .select(CONVERSATION_SESSION_SELECT)
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        throw new Error("Unable to load conversation session.");
      }

      return isConversationSessionRow(data) ? data : null;
    },

    async createConversationSession(input) {
      const { data, error } = await supabase
        .from("conversation_sessions")
        .insert({
          user_id: input.userId,
          mode: input.mode,
          state_token: input.stateToken,
          current_step_id: null,
          last_inbound_message_sid: null,
        })
        .select(CONVERSATION_SESSION_SELECT)
        .single();

      if (error || !isConversationSessionRow(data)) {
        throw new Error("Unable to create conversation session.");
      }

      return data;
    },

    async updateConversationSession(sessionId, patch) {
      const { data, error } = await supabase
        .from("conversation_sessions")
        .update(patch)
        .eq("id", sessionId)
        .select(CONVERSATION_SESSION_SELECT)
        .single();

      if (error || !isConversationSessionRow(data)) {
        throw new Error("Unable to update conversation session.");
      }

      return data;
    },

    async hasConversationEvent(idempotencyKey) {
      const { data, error } = await supabase
        .from("conversation_events")
        .select("id")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();

      if (error) {
        throw new Error("Unable to load conversation event.");
      }

      return Boolean(data?.id);
    },

    async insertConversationEvent(input) {
      const { error } = await supabase
        .from("conversation_events")
        .insert({
          conversation_session_id: input.conversationSessionId,
          user_id: input.userId,
          profile_id: input.profileId,
          event_type: input.eventType,
          step_token: input.stepToken,
          payload: input.payload,
          idempotency_key: input.idempotencyKey,
        });

      if (error && !isDuplicateKeyError(error)) {
        throw new Error("Unable to insert conversation event.");
      }
    },
  };
}

function createDefaultSendSmsText() {
  return async (input: SendSmsTextInput): Promise<void> => {
    const supabase = getServiceRoleClient();
    const twilio = resolveTwilioRuntimeFromEnv({
      getEnv: createNodeEnvReader(),
    });
    const encryptionKey = requireEnv("SMS_BODY_ENCRYPTION_KEY");
    const encryptedBody = await encryptSmsBody(supabase, {
      plaintext: input.body,
      key: encryptionKey,
    });

    await sendSms({
      client: twilio.client,
      db: supabase,
      to: input.toE164,
      body: input.body,
      correlationId: input.correlationId,
      purpose: input.purpose,
      idempotencyKey: input.idempotencyKey,
      userId: input.userId,
      messagingServiceSid: twilio.senderIdentity.messagingServiceSid,
      from: twilio.senderIdentity.from,
      statusCallbackUrl: twilio.statusCallbackUrl,
      bodyCiphertext: encryptedBody,
      keyVersion: 1,
      mediaCount: 0,
    });
  };
}

async function ensureVerifiedLifecycle(
  userId: string,
  dependencies: RegistrationLifecycleDependencies,
): Promise<RegistrationStateResponse> {
  const nowIso = dependencies.now().toISOString();
  let user = await requireUserById(dependencies.repository, userId);

  if (user.state === "unverified") {
    user = await dependencies.repository.updateUser(user.id, { state: "verified" });
  }

  const region = user.region_id
    ? await dependencies.repository.findRegionById(user.region_id)
    : null;

  if (!region) {
    throw new Error("Verified registration user is missing a region assignment.");
  }

  const location = resolveLocationFromRegion(region.slug);
  const profile = await ensureProfile(user.id, location, dependencies, nowIso);

  await dependencies.repository.upsertProfileRegionAssignment({
    profileId: profile.id,
    regionId: region.id,
    assignmentSource: region.slug === "us-wa" ? "zip_lookup" : "waitlist",
    assignedAtIso: nowIso,
  });

  if (region.state === "open") {
    await dependencies.repository.upsertRegionMembership({
      userId: user.id,
      regionId: region.id,
      status: "active",
      joinedAtIso: nowIso,
    });
    await dependencies.repository.markWaitlistActivated({
      profileId: profile.id,
      activatedAtIso: nowIso,
    });
    user = await dependencies.repository.updateUser(user.id, { state: "interviewing" });
    const conversationSession = await ensureOnboardingConversationActivated({
      user,
      profile,
      dependencies,
    });
    const waitlist = await dependencies.repository.findWaitlistEntryByProfileId(profile.id);

    return {
      user: serializeUser(user),
      profile: serializeProfile(profile),
      conversation_session: serializeConversationSession(conversationSession),
      region: serializeRegion(region),
      waitlist: waitlist ? serializeWaitlist(waitlist) : null,
      next_action: "begin_onboarding",
    };
  }

  await dependencies.repository.upsertRegionMembership({
    userId: user.id,
    regionId: region.id,
    status: "waitlisted",
    joinedAtIso: nowIso,
  });
  await dependencies.repository.upsertWaitlistEntry({
    profileId: profile.id,
    userId: user.id,
    regionId: region.id,
    status: "waiting",
    source: "website_registration",
    reason: "region_waitlist_after_otp_verify",
  });

  const conversationSession = await ensureDormantConversationSession(user.id, dependencies);
  const waitlist = await dependencies.repository.findWaitlistEntryByProfileId(profile.id);

  return {
    user: serializeUser(user),
    profile: serializeProfile(profile),
    conversation_session: serializeConversationSession(conversationSession),
    region: serializeRegion(region),
    waitlist: waitlist ? serializeWaitlist(waitlist) : null,
    next_action: "waitlist",
  };
}

async function ensureProfile(
  userId: string,
  location: { countryCode: string | null; stateCode: string | null },
  dependencies: RegistrationLifecycleDependencies,
  nowIso: string,
): Promise<ProfileRecord> {
  const existingProfile = await dependencies.repository.findProfileByUserId(userId);

  if (!existingProfile) {
    return dependencies.repository.createProfile({
      userId,
      countryCode: location.countryCode,
      stateCode: location.stateCode,
    });
  }

  return dependencies.repository.updateProfile(existingProfile.id, {
    country_code: location.countryCode,
    state_code: location.stateCode,
    status_reason: existingProfile.state === "empty"
      ? "registration_verified"
      : "registration_reactivated",
  });
}

async function ensureDormantConversationSession(
  userId: string,
  dependencies: RegistrationLifecycleDependencies,
): Promise<ConversationSessionRecord> {
  const existing = await dependencies.repository.findConversationSessionByUserId(userId);

  if (existing) {
    return existing;
  }

  return dependencies.repository.createConversationSession({
    userId,
    mode: "idle",
    stateToken: "idle",
  });
}

async function ensureOnboardingConversationActivated(params: {
  user: UserRecord;
  profile: ProfileRecord;
  dependencies: RegistrationLifecycleDependencies;
}): Promise<ConversationSessionRecord> {
  const openingEventIdempotencyKey = `${ONBOARDING_OPENING_EVENT_IDEMPOTENCY_PREFIX}${params.user.id}`;
  const existingSession = await params.dependencies.repository.findConversationSessionByUserId(params.user.id);

  if (
    existingSession?.mode === "interviewing" &&
    existingSession.state_token.startsWith("interview:")
  ) {
    return existingSession;
  }

  const baseSession = existingSession
    ? await params.dependencies.repository.updateConversationSession(existingSession.id, {
      mode: "interviewing",
      state_token: existingSession.state_token.startsWith("onboarding:")
        ? existingSession.state_token
        : "onboarding:awaiting_opening_response",
      current_step_id: null,
      last_inbound_message_sid: null,
    })
    : await params.dependencies.repository.createConversationSession({
      userId: params.user.id,
      mode: "interviewing",
      stateToken: "onboarding:awaiting_opening_response",
    });

  const hasOpeningBeenSent = await params.dependencies.repository.hasConversationEvent(
    openingEventIdempotencyKey,
  );

  await startOnboardingForUser({
    firstName: params.user.first_name,
    currentStateToken: baseSession.state_token.startsWith("onboarding:")
      ? baseSession.state_token
      : null,
    hasOpeningBeenSent,
    openingIdempotencyKey: `${ONBOARDING_OPENING_SEND_IDEMPOTENCY_PREFIX}${params.user.id}`,
    sendMessage: async (sendInput) => {
      await params.dependencies.sendSmsText({
        userId: params.user.id,
        toE164: params.user.phone_e164,
        body: sendInput.body,
        purpose: sendInput.messageKey,
        idempotencyKey: sendInput.idempotencyKey,
        correlationId: params.user.id,
      });
    },
    persistState: async (persistInput) => {
      await params.dependencies.repository.updateConversationSession(baseSession.id, {
        mode: "interviewing",
        state_token: persistInput.nextStateToken,
        current_step_id: null,
        last_inbound_message_sid: null,
      });
    },
  });

  await params.dependencies.repository.insertConversationEvent({
    conversationSessionId: baseSession.id,
    userId: params.user.id,
    profileId: params.profile.id,
    eventType: "onboarding_opening_sent",
    stepToken: "onboarding:awaiting_opening_response",
    idempotencyKey: openingEventIdempotencyKey,
    payload: {
      source: "registration_otp_verify",
    },
  });

  return requireConversationSessionByUserId(params.dependencies.repository, params.user.id);
}

async function requireUserById(
  repository: RegistrationLifecycleRepository,
  userId: string,
): Promise<UserRecord> {
  const user = await repository.findUserById(userId);
  if (!user) {
    throw new RegistrationLifecycleError(404, "USER_NOT_FOUND", "User not found.");
  }
  return user;
}

async function requireOtpSessionById(
  repository: RegistrationLifecycleRepository,
  otpSessionId: string,
): Promise<OtpSessionRecord> {
  const otpSession = await repository.findOtpSessionById(otpSessionId);
  if (!otpSession) {
    throw new RegistrationLifecycleError(404, "OTP_SESSION_NOT_FOUND", "OTP session not found.");
  }
  return otpSession;
}

async function requireRegionBySlug(
  repository: RegistrationLifecycleRepository,
  slug: string,
): Promise<RegionRecord> {
  const region = await repository.findRegionBySlug(slug);
  if (!region) {
    throw new Error(`Region slug '${slug}' is not configured.`);
  }
  return region;
}

async function requireConversationSessionByUserId(
  repository: RegistrationLifecycleRepository,
  userId: string,
): Promise<ConversationSessionRecord> {
  const session = await repository.findConversationSessionByUserId(userId);
  if (!session) {
    throw new Error("Conversation session not found after activation.");
  }
  return session;
}

function validateRegisterInput(input: RegisterWebsiteUserInput): RegisterWebsiteUserInput & {
  email: string | null;
} {
  const firstName = normalizeRequiredText(input.firstName, "First name is required.");
  const lastName = normalizeRequiredText(input.lastName, "Last name is required.");
  const countryCode = normalizeRequiredText(input.countryCode, "Country code is required.");
  const phoneNumber = normalizeRequiredText(input.phoneNumber, "Phone number is required.");
  const birthday = normalizeBirthday(input.birthday);
  const zipCode = normalizeRequiredText(input.zipCode, "ZIP code is required.");
  const email = normalizeOptionalEmail(input.email ?? null);

  if (!input.smsConsent || !input.ageConsent || !input.termsConsent || !input.privacyConsent) {
    throw new RegistrationLifecycleError(
      400,
      "CONSENT_REQUIRED",
      "All required consents must be accepted.",
    );
  }

  return {
    firstName,
    lastName,
    countryCode,
    phoneNumber,
    email,
    birthday,
    zipCode,
    smsConsent: true,
    ageConsent: true,
    termsConsent: true,
    privacyConsent: true,
  };
}

function validateSendOtpInput(input: SendWebsiteOtpInput): SendWebsiteOtpInput {
  return {
    userId: normalizeUuidLike(input.userId, "User id is required."),
  };
}

function validateVerifyOtpInput(input: VerifyWebsiteOtpInput): VerifyWebsiteOtpInput {
  const code = normalizeRequiredText(input.code, "OTP code is required.").replace(/\s+/g, "");
  if (!new RegExp(`^\\d{${OTP_LENGTH}}$`).test(code)) {
    throw new RegistrationLifecycleError(400, "OTP_INVALID", "OTP code must be 6 digits.");
  }

  return {
    userId: normalizeUuidLike(input.userId, "User id is required."),
    otpSessionId: normalizeUuidLike(input.otpSessionId, "OTP session id is required."),
    code,
  };
}

function normalizeRequiredText(value: string | null | undefined, message: string): string {
  if (typeof value !== "string") {
    throw new RegistrationLifecycleError(400, "INVALID_INPUT", message);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new RegistrationLifecycleError(400, "INVALID_INPUT", message);
  }
  return trimmed;
}

function normalizeOptionalEmail(value: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    throw new RegistrationLifecycleError(400, "INVALID_EMAIL", "Email address is invalid.");
  }
  return trimmed.toLowerCase();
}

function normalizeBirthday(value: string): string {
  const trimmed = normalizeRequiredText(value, "Birthday is required.");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) {
    throw new RegistrationLifecycleError(400, "INVALID_BIRTHDAY", "Birthday is invalid.");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new RegistrationLifecycleError(400, "INVALID_BIRTHDAY", "Birthday is invalid.");
  }

  const now = new Date();
  const adultCutoff = new Date(Date.UTC(
    now.getUTCFullYear() - 18,
    now.getUTCMonth(),
    now.getUTCDate(),
  ));

  if (parsed > adultCutoff) {
    throw new RegistrationLifecycleError(
      400,
      "AGE_REQUIREMENT_NOT_MET",
      "You must be at least 18 years old to register.",
    );
  }

  return trimmed;
}

function normalizeUuidLike(value: string, message: string): string {
  const trimmed = normalizeRequiredText(value, message);
  return trimmed;
}

function resolveLocationFromZip(zipCode: string): LocationResolution {
  const trimmed = zipCode.trim();
  const digits = trimmed.replace(/\D/g, "");

  if (digits.length >= 5) {
    const zip5 = digits.slice(0, 5);
    const zipNumber = Number(zip5);
    if (zipNumber >= 98000 && zipNumber <= 99499) {
      return {
        normalizedZip: zip5,
        countryCode: "US",
        stateCode: "WA",
      };
    }

    return {
      normalizedZip: zip5,
      countryCode: "US",
      stateCode: null,
    };
  }

  return {
    normalizedZip: trimmed.length > 0 ? trimmed : null,
    countryCode: null,
    stateCode: null,
  };
}

function resolveLocationFromRegion(regionSlug: string): {
  countryCode: string | null;
  stateCode: string | null;
} {
  if (regionSlug === "us-wa") {
    return {
      countryCode: "US",
      stateCode: "WA",
    };
  }

  return {
    countryCode: null,
    stateCode: null,
  };
}

function normalizePhoneToE164(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new RegistrationLifecycleError(400, "INVALID_PHONE", "Phone number is required.");
  }

  let candidate = trimmed.replace(/[\s().-]/g, "");

  if (candidate.startsWith("00")) {
    candidate = `+${candidate.slice(2)}`;
  }

  if (candidate.startsWith("+")) {
    candidate = `+${candidate.slice(1).replace(/\D/g, "")}`;
  } else {
    const digits = candidate.replace(/\D/g, "");
    candidate = digits.length === 10 ? `+1${digits}` : `+${digits}`;
  }

  if (!/^\+[1-9]\d{7,14}$/.test(candidate)) {
    throw new RegistrationLifecycleError(
      400,
      "INVALID_PHONE",
      "Phone number must normalize to a valid E.164 number.",
    );
  }

  return candidate;
}

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hashOtpCode(code: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const digest = crypto.scryptSync(code, salt, 32).toString("hex");
  return `${salt}$${digest}`;
}

function verifyOtpCode(code: string, storedHash: string): boolean {
  const [salt, expectedHash] = storedHash.split("$");
  if (!salt || !expectedHash) {
    return false;
  }

  const actual = crypto.scryptSync(code, salt, expectedHash.length / 2);
  const expected = Buffer.from(expectedHash, "hex");

  if (actual.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(actual, expected);
}

function buildRegistrationOtpMessage(code: string): string {
  return `Your JOSH verification code is ${code}. It expires in ${OTP_EXPIRY_MINUTES} minutes.`;
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function isOtpSessionExpired(session: OtpSessionRecord, now: Date): boolean {
  return new Date(session.expires_at).getTime() <= now.getTime();
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable '${name}'.`);
  }
  return value;
}

function toErrorResponse(error: unknown): Response {
  if (error instanceof RegistrationLifecycleError) {
    return jsonResponse(
      {
        error: error.message,
        code: error.code,
      },
      error.status,
    );
  }

  const message = error instanceof Error ? error.message : "Internal server error.";
  return jsonResponse(
    {
      error: message,
      code: "INTERNAL_ERROR",
    },
    500,
  );
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function serializeUser(user: UserRecord): RegistrationStateResponse["user"] {
  return {
    id: user.id,
    state: user.state,
    phone_e164: user.phone_e164,
    first_name: user.first_name,
    last_name: user.last_name,
    birthday: user.birthday,
    email: user.email,
  };
}

function serializeProfile(profile: ProfileRecord): NonNullable<RegistrationStateResponse["profile"]> {
  return {
    id: profile.id,
    state: profile.state,
    country_code: profile.country_code,
    state_code: profile.state_code,
  };
}

function serializeConversationSession(
  session: ConversationSessionRecord,
): NonNullable<RegistrationStateResponse["conversation_session"]> {
  return {
    id: session.id,
    mode: session.mode,
    state_token: session.state_token,
    current_step_id: session.current_step_id,
  };
}

function serializeRegion(region: RegionRecord): NonNullable<RegistrationStateResponse["region"]> {
  return {
    id: region.id,
    slug: region.slug,
    state: region.state,
    name: region.name,
  };
}

function serializeWaitlist(
  waitlist: WaitlistEntryRecord,
): NonNullable<RegistrationStateResponse["waitlist"]> {
  return {
    id: waitlist.id,
    status: waitlist.status,
    region_id: waitlist.region_id,
  };
}

function getServiceRoleClient() {
  if (!cachedServiceRoleClient) {
    cachedServiceRoleClient = createServiceRoleDbClient();
  }

  if (!cachedServiceRoleClient) {
    throw new Error("Unable to initialize service role client.");
  }

  return cachedServiceRoleClient;
}

function isDuplicateKeyError(error: { code?: string | null } | null): boolean {
  return error?.code === "23505";
}

const USER_SELECT =
  "id,phone_e164,phone_hash,first_name,last_name,birthday,email,state,sms_consent,age_consent,terms_consent,privacy_consent,region_id,registration_source,deleted_at";
const REGION_SELECT = "id,slug,state,name,display_name";
const OTP_SESSION_SELECT = "id,user_id,otp_hash,expires_at,verified_at,attempts,updated_at";
const PROFILE_SELECT = "id,user_id,state,country_code,state_code";
const CONVERSATION_SESSION_SELECT =
  "id,user_id,mode,state_token,current_step_id,last_inbound_message_sid";
const WAITLIST_SELECT = "id,profile_id,region_id,status";

function isUserRow(value: unknown): value is UserRecord {
  return Boolean(value && typeof value === "object" && (value as { id?: unknown }).id);
}

function isRegionRow(value: unknown): value is RegionRecord {
  return Boolean(value && typeof value === "object" && (value as { id?: unknown }).id);
}

function isOtpSessionRow(value: unknown): value is OtpSessionRecord {
  return Boolean(value && typeof value === "object" && (value as { id?: unknown }).id);
}

function isProfileRow(value: unknown): value is ProfileRecord {
  return Boolean(value && typeof value === "object" && (value as { id?: unknown }).id);
}

function isConversationSessionRow(value: unknown): value is ConversationSessionRecord {
  return Boolean(value && typeof value === "object" && (value as { id?: unknown }).id);
}

function isWaitlistRow(value: unknown): value is WaitlistEntryRecord {
  return Boolean(value && typeof value === "object" && (value as { id?: unknown }).id);
}
