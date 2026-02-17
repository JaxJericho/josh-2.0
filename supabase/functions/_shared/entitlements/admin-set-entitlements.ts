export const ENTITLEMENT_MUTABLE_FIELDS = [
  "can_initiate",
  "can_participate",
  "can_exchange_contact",
  "region_override",
  "waitlist_override",
  "safety_override",
] as const;

export const OVERRIDE_FIELDS = [
  "region_override",
  "waitlist_override",
  "safety_override",
] as const;

export type EntitlementMutableField = (typeof ENTITLEMENT_MUTABLE_FIELDS)[number];
export type OverrideField = (typeof OVERRIDE_FIELDS)[number];

export type EntitlementFieldPatch = Partial<Record<EntitlementMutableField, boolean>>;

export type AdminSetEntitlementsCommand = {
  profile_id: string;
  fields: EntitlementFieldPatch;
  reason: string | null;
};

export type AdminSetEntitlementsActor = {
  admin_user_id: string | null;
  admin_profile_id: string | null;
};

export type ProfileEntitlementsRecord = {
  id: string;
  profile_id: string;
  can_initiate: boolean;
  can_participate: boolean;
  can_exchange_contact: boolean;
  region_override: boolean;
  waitlist_override: boolean;
  safety_override: boolean;
  reason: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminSetEntitlementsRepository = {
  upsertProfileEntitlements: (input: {
    profile_id: string;
    fields: EntitlementFieldPatch;
    reason: string | null;
    updated_by: string | null;
  }) => Promise<ProfileEntitlementsRecord>;
  writeAuditLog: (input: {
    admin_user_id: string | null;
    profile_id: string;
    reason: string | null;
    fields: EntitlementFieldPatch;
    updated_by: string | null;
    idempotency_key: string;
  }) => Promise<"inserted" | "duplicate">;
};

export type AdminSetEntitlementsResult = {
  profile_entitlements: ProfileEntitlementsRecord;
  idempotency_key: string;
  audit_log: "inserted" | "duplicate";
};

export class AdminSetEntitlementsError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AdminSetEntitlementsError";
    this.status = status;
    this.code = code;
  }
}

export function parseAdminSetEntitlementsRequest(
  input: unknown,
): AdminSetEntitlementsCommand {
  if (!isRecord(input)) {
    throw new AdminSetEntitlementsError(
      400,
      "INVALID_REQUEST",
      "Request body must be a JSON object.",
    );
  }

  const profileId = normalizeRequiredString(input.profile_id, "profile_id");
  const fields = parseFieldPatch(input);

  if (Object.keys(fields).length === 0) {
    throw new AdminSetEntitlementsError(
      400,
      "INVALID_REQUEST",
      "At least one entitlement field must be provided.",
    );
  }

  const reason = normalizeOptionalString(input.reason);
  if (hasRequiredOverrideReason(fields) && !reason) {
    throw new AdminSetEntitlementsError(
      400,
      "INVALID_REQUEST",
      "reason is required when any override field is set to true.",
    );
  }

  return {
    profile_id: profileId,
    fields,
    reason,
  };
}

export async function executeAdminSetEntitlements(params: {
  command: AdminSetEntitlementsCommand;
  actor: AdminSetEntitlementsActor;
  repository: AdminSetEntitlementsRepository;
}): Promise<AdminSetEntitlementsResult> {
  const idempotencyKey = buildAdminSetEntitlementsIdempotencyKey({
    command: params.command,
    actor: params.actor,
  });

  const profileEntitlements = await params.repository.upsertProfileEntitlements({
    profile_id: params.command.profile_id,
    fields: params.command.fields,
    reason: params.command.reason,
    updated_by: params.actor.admin_profile_id,
  });

  const auditResult = await params.repository.writeAuditLog({
    admin_user_id: params.actor.admin_user_id,
    profile_id: params.command.profile_id,
    reason: params.command.reason,
    fields: params.command.fields,
    updated_by: params.actor.admin_profile_id,
    idempotency_key: idempotencyKey,
  });

  return {
    profile_entitlements: profileEntitlements,
    idempotency_key: idempotencyKey,
    audit_log: auditResult,
  };
}

export function buildAdminSetEntitlementsIdempotencyKey(params: {
  command: AdminSetEntitlementsCommand;
  actor: AdminSetEntitlementsActor;
}): string {
  const normalizedPayload = stableJson({
    profile_id: params.command.profile_id,
    fields: params.command.fields,
    reason: params.command.reason,
    admin_user_id: params.actor.admin_user_id,
    admin_profile_id: params.actor.admin_profile_id,
  });

  return `admin_set_entitlements:${normalizedPayload}`;
}

function parseFieldPatch(input: Record<string, unknown>): EntitlementFieldPatch {
  const patch: EntitlementFieldPatch = {};

  for (const field of ENTITLEMENT_MUTABLE_FIELDS) {
    const value = input[field];
    if (typeof value === "undefined") {
      continue;
    }

    if (typeof value !== "boolean") {
      throw new AdminSetEntitlementsError(
        400,
        "INVALID_REQUEST",
        `'${field}' must be a boolean when provided.`,
      );
    }

    patch[field] = value;
  }

  return patch;
}

function hasRequiredOverrideReason(fields: EntitlementFieldPatch): boolean {
  return OVERRIDE_FIELDS.some((field) => fields[field] === true);
}

function normalizeRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new AdminSetEntitlementsError(
      400,
      "INVALID_REQUEST",
      `'${field}' must be a non-empty string.`,
    );
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new AdminSetEntitlementsError(
      400,
      "INVALID_REQUEST",
      `'${field}' must be a non-empty string.`,
    );
  }

  return normalized;
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value === "undefined" || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new AdminSetEntitlementsError(
      400,
      "INVALID_REQUEST",
      "reason must be a string when provided.",
    );
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }

  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
