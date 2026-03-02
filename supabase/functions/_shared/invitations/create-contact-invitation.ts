const CONTACT_INVITATION_PENDING_STATUS = "pending";
const CONTACT_INVITATION_JOB_PURPOSE = "contact_invitation_invite_v1";
const CONTACT_INVITATION_TEMPLATE_KEY = "contact_invitation_sms_v1";
const CONTACT_INVITATION_FALLBACK_NAME = "A friend";
const CONTACT_CIRCLE_FALLBACK_NAME = "Friend";
const A2P_BLOCKED_RUN_AT = "2099-01-01T00:00:00.000Z";
const HASH_ENCODER = new TextEncoder();

type SupabaseClientLike = {
  from: (table: string) => any;
  rpc?: (fn: string, args?: Record<string, unknown>) => Promise<any>;
};

type CreationOutcome = "created" | "reused";

export type CreateContactInvitationInput = {
  supabase: SupabaseClientLike;
  inviter_user_id: string;
  inviter_profile_id: string;
  invitee_phone_e164: string;
  sms_encryption_key: string;
  inviter_display_name?: string | null;
  invitee_display_name?: string | null;
  invitation_context?: string | null;
  audit_idempotency_key?: string | null;
};

export type CreateContactInvitationResult = {
  invitation_id: string;
  invitation_outcome: CreationOutcome;
  outbound_job_id: string;
  outbound_job_outcome: CreationOutcome;
  invitee_phone_hash: string;
  invitee_phone_e164: string;
  outbound_job_purpose: string;
  outbound_job_dispatchable: false;
};

type ContactInvitationRow = {
  id: string;
  status: string | null;
};

type OutboundJobRow = {
  id: string;
};

export async function createContactInvitationWithSupabase(
  input: CreateContactInvitationInput,
): Promise<CreateContactInvitationResult> {
  const normalizedInviteePhone = normalizePhoneToE164(input.invitee_phone_e164);
  const inviteePhoneHash = await sha256Hex(normalizedInviteePhone);
  const inviterDisplayName = normalizeDisplayName(
    input.inviter_display_name,
    CONTACT_INVITATION_FALLBACK_NAME,
  );
  const inviteeDisplayName = normalizeDisplayName(
    input.invitee_display_name,
    CONTACT_CIRCLE_FALLBACK_NAME,
  );
  const invitationContext = normalizeOptionalText(input.invitation_context);
  const invitationContextHash = invitationContext
    ? await sha256Hex(invitationContext)
    : null;

  await ensureContactCircleEntry({
    supabase: input.supabase,
    inviterUserId: input.inviter_user_id,
    inviteePhoneHash,
    inviteePhoneE164: normalizedInviteePhone,
    inviteeDisplayName,
  });

  const invitationResult = await createOrReusePendingInvitation({
    supabase: input.supabase,
    inviterUserId: input.inviter_user_id,
    inviteePhoneHash,
  });

  const outboundResult = await createOrReuseOutboundJob({
    supabase: input.supabase,
    invitationId: invitationResult.row.id,
    inviterUserId: input.inviter_user_id,
    inviterDisplayName,
    inviteePhoneE164: normalizedInviteePhone,
    smsEncryptionKey: input.sms_encryption_key,
  });

  await writeContactInvitationAuditEvent({
    supabase: input.supabase,
    inviterUserId: input.inviter_user_id,
    inviterProfileId: input.inviter_profile_id,
    inviteePhoneHash,
    invitationId: invitationResult.row.id,
    invitationOutcome: invitationResult.outcome,
    outboundJobId: outboundResult.row.id,
    outboundJobOutcome: outboundResult.outcome,
    inviterDisplayName,
    invitationContextHash,
    auditIdempotencyKey: normalizeOptionalText(input.audit_idempotency_key),
  });

  return {
    invitation_id: invitationResult.row.id,
    invitation_outcome: invitationResult.outcome,
    outbound_job_id: outboundResult.row.id,
    outbound_job_outcome: outboundResult.outcome,
    invitee_phone_hash: inviteePhoneHash,
    invitee_phone_e164: normalizedInviteePhone,
    outbound_job_purpose: CONTACT_INVITATION_JOB_PURPOSE,
    outbound_job_dispatchable: false,
  };
}

async function ensureContactCircleEntry(input: {
  supabase: SupabaseClientLike;
  inviterUserId: string;
  inviteePhoneHash: string;
  inviteePhoneE164: string;
  inviteeDisplayName: string;
}): Promise<void> {
  const { error } = await input.supabase
    .from("contact_circle")
    .insert(
      {
        user_id: input.inviterUserId,
        contact_name: input.inviteeDisplayName,
        contact_phone_hash: input.inviteePhoneHash,
        contact_phone_e164: input.inviteePhoneE164,
      },
      {
        onConflict: "user_id,contact_phone_hash",
        ignoreDuplicates: true,
      },
    );

  if (error && !isDuplicateKeyError(error)) {
    throw new Error("Unable to persist contact circle entry for invitation.");
  }
}

async function createOrReusePendingInvitation(input: {
  supabase: SupabaseClientLike;
  inviterUserId: string;
  inviteePhoneHash: string;
}): Promise<{ row: ContactInvitationRow; outcome: CreationOutcome }> {
  const existing = await findPendingInvitation(input.supabase, {
    inviterUserId: input.inviterUserId,
    inviteePhoneHash: input.inviteePhoneHash,
  });

  if (existing) {
    return {
      row: existing,
      outcome: "reused",
    };
  }

  const { data, error } = await input.supabase
    .from("contact_invitations")
    .insert({
      inviter_user_id: input.inviterUserId,
      invitee_phone_hash: input.inviteePhoneHash,
      status: CONTACT_INVITATION_PENDING_STATUS,
      plan_brief_id: null,
    })
    .select("id,status")
    .single();

  if (error && isDuplicateKeyError(error)) {
    const duplicate = await findPendingInvitation(input.supabase, {
      inviterUserId: input.inviterUserId,
      inviteePhoneHash: input.inviteePhoneHash,
    });

    if (duplicate) {
      return {
        row: duplicate,
        outcome: "reused",
      };
    }
  }

  if (error || !data?.id) {
    throw new Error("Unable to create pending contact invitation.");
  }

  return {
    row: {
      id: data.id,
      status: data.status ?? CONTACT_INVITATION_PENDING_STATUS,
    },
    outcome: "created",
  };
}

async function findPendingInvitation(
  supabase: SupabaseClientLike,
  input: {
    inviterUserId: string;
    inviteePhoneHash: string;
  },
): Promise<ContactInvitationRow | null> {
  const { data, error } = await supabase
    .from("contact_invitations")
    .select("id,status,created_at")
    .eq("inviter_user_id", input.inviterUserId)
    .eq("invitee_phone_hash", input.inviteePhoneHash)
    .eq("status", CONTACT_INVITATION_PENDING_STATUS)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error("Unable to load pending contact invitation.");
  }

  if (!data?.id) {
    return null;
  }

  return {
    id: data.id,
    status: data.status ?? CONTACT_INVITATION_PENDING_STATUS,
  };
}

async function createOrReuseOutboundJob(input: {
  supabase: SupabaseClientLike;
  invitationId: string;
  inviterUserId: string;
  inviterDisplayName: string;
  inviteePhoneE164: string;
  smsEncryptionKey: string;
}): Promise<{ row: OutboundJobRow; outcome: CreationOutcome }> {
  const idempotencyKey = buildOutboundJobIdempotencyKey(input.invitationId);

  const existing = await findOutboundJobByIdempotencyKey(
    input.supabase,
    idempotencyKey,
  );
  if (existing) {
    return {
      row: existing,
      outcome: "reused",
    };
  }

  const encryptedBody = await encryptInviteBody(
    input.supabase,
    buildContactInviteSmsBody(input.inviterDisplayName),
    input.smsEncryptionKey,
  );

  const { error } = await input.supabase
    .from("sms_outbound_jobs")
    .insert(
      {
        user_id: input.inviterUserId,
        to_e164: input.inviteePhoneE164,
        body_ciphertext: encryptedBody,
        body_iv: null,
        body_tag: null,
        key_version: 1,
        purpose: CONTACT_INVITATION_JOB_PURPOSE,
        status: "pending",
        attempts: 0,
        next_attempt_at: null,
        run_at: A2P_BLOCKED_RUN_AT,
        last_error: `A2P_GATE_BLOCKED:${CONTACT_INVITATION_TEMPLATE_KEY}`,
        twilio_message_sid: null,
        correlation_id: input.invitationId,
        idempotency_key: idempotencyKey,
      },
      {
        onConflict: "idempotency_key",
        ignoreDuplicates: true,
      },
    );

  if (error && !isDuplicateKeyError(error)) {
    throw new Error("Unable to persist outbound invitation job.");
  }

  const persisted = await findOutboundJobByIdempotencyKey(
    input.supabase,
    idempotencyKey,
  );

  if (!persisted) {
    throw new Error("Outbound invitation job insert did not return a row.");
  }

  return {
    row: persisted,
    outcome: error ? "reused" : "created",
  };
}

async function findOutboundJobByIdempotencyKey(
  supabase: SupabaseClientLike,
  idempotencyKey: string,
): Promise<OutboundJobRow | null> {
  const { data, error } = await supabase
    .from("sms_outbound_jobs")
    .select("id")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (error) {
    throw new Error("Unable to load outbound invitation job state.");
  }

  if (!data?.id) {
    return null;
  }

  return { id: data.id };
}

async function writeContactInvitationAuditEvent(input: {
  supabase: SupabaseClientLike;
  inviterUserId: string;
  inviterProfileId: string;
  inviteePhoneHash: string;
  invitationId: string;
  invitationOutcome: CreationOutcome;
  outboundJobId: string;
  outboundJobOutcome: CreationOutcome;
  inviterDisplayName: string;
  invitationContextHash: string | null;
  auditIdempotencyKey: string | null;
}): Promise<void> {
  const { error } = await input.supabase
    .from("audit_log")
    .insert({
      action: "contact_invitation_created",
      target_type: "contact_invitation",
      target_id: input.invitationId,
      reason: "contact_invitation_created",
      payload: {
        inviter_user_id: input.inviterUserId,
        inviter_profile_id: input.inviterProfileId,
        invitee_phone_hash: input.inviteePhoneHash,
        invitation_id: input.invitationId,
        invitation_outcome: input.invitationOutcome,
        outbound_job_id: input.outboundJobId,
        outbound_job_outcome: input.outboundJobOutcome,
        outbound_job_purpose: CONTACT_INVITATION_JOB_PURPOSE,
        outbound_job_dispatchable: false,
        template_key: CONTACT_INVITATION_TEMPLATE_KEY,
        template_variables: {
          inviter_display_name: input.inviterDisplayName,
          reply_instruction: "Reply YES to join",
          invitation_statement: "This is an invitation from a friend",
        },
        invitation_context_hash: input.invitationContextHash,
        reason: "contact_invitation_created",
      },
      idempotency_key: input.auditIdempotencyKey,
      correlation_id: input.invitationId,
    });

  if (error && !isDuplicateKeyError(error)) {
    throw new Error("Unable to persist contact invitation audit event.");
  }
}

async function encryptInviteBody(
  supabase: SupabaseClientLike,
  body: string,
  key: string,
): Promise<string> {
  if (!supabase.rpc) {
    throw new Error("Supabase client does not support RPC for invite body encryption.");
  }

  const { data, error } = await supabase.rpc("encrypt_sms_body", {
    plaintext: body,
    key,
  });

  if (error || !data) {
    throw new Error("Unable to encrypt invitation SMS body.");
  }

  return String(data);
}

export function buildContactInviteSmsBody(inviterDisplayName: string): string {
  const safeDisplayName = normalizeDisplayName(inviterDisplayName, CONTACT_INVITATION_FALLBACK_NAME);
  return `Hi - ${safeDisplayName} invited you to join JOSH. Reply YES to join. This is an invitation from a friend.`;
}

function buildOutboundJobIdempotencyKey(invitationId: string): string {
  return `contact_invitation_invite:${invitationId}:v1`;
}

export function normalizePhoneToE164(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Invitee phone number is required.");
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
    throw new Error("Invitee phone number must normalize to a valid E.164 number.");
  }

  return candidate;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", HASH_ENCODER.encode(value));
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (let index = 0; index < bytes.length; index += 1) {
    hex += bytes[index].toString(16).padStart(2, "0");
  }
  return hex;
}

function normalizeDisplayName(value: string | null | undefined, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isDuplicateKeyError(error: { code?: string; message?: string } | null): boolean {
  if (!error) {
    return false;
  }

  if (error.code === "23505") {
    return true;
  }

  const message = error.message ?? "";
  return message.toLowerCase().includes("duplicate key");
}
