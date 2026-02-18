export const DEFAULT_WAITLIST_BATCH_LIMIT = 50;
export const MAX_WAITLIST_BATCH_LIMIT = 500;

export const ELIGIBLE_WAITLIST_STATUSES = ["waiting", "onboarded"] as const;
export type EligibleWaitlistStatus = (typeof ELIGIBLE_WAITLIST_STATUSES)[number];

export const SUPPORTED_NOTIFICATION_TEMPLATE_VERSIONS = ["v1"] as const;
export type NotificationTemplateVersion =
  (typeof SUPPORTED_NOTIFICATION_TEMPLATE_VERSIONS)[number];

export type WaitlistBatchNotifyRequest = {
  region_slug: string;
  limit: number;
  dry_run: boolean;
  open_region: boolean;
  notification_template_version: NotificationTemplateVersion;
};

export type WaitlistBatchRegion = {
  id: string;
  slug: string;
  display_name: string;
  is_active: boolean;
};

export type WaitlistBatchEntry = {
  id: string;
  profile_id: string;
  user_id: string;
  region_id: string;
  status: string;
  created_at: string;
  last_notified_at: string | null;
  notified_at: string | null;
  updated_at: string | null;
};

export type WaitlistBatchNotifySummary = {
  region_slug: string;
  open_region_applied: boolean;
  dry_run: boolean;
  selected_count: number;
  claimed_count: number;
  attempted_send_count: number;
  sent_count: number;
  skipped_already_notified_count: number;
  errors: Array<{ code: string; message: string; entry_id?: string }>;
};

export type EnqueueResult = "inserted" | "duplicate";

export type WaitlistBatchNotifyRepository = {
  findRegionBySlug: (slug: string) => Promise<WaitlistBatchRegion | null>;
  openRegion: (regionId: string) => Promise<boolean>;
  selectEligibleEntries: (
    regionId: string,
    limit: number,
  ) => Promise<WaitlistBatchEntry[]>;
  claimEntries: (
    regionId: string,
    entryIds: string[],
    claimedAtIso: string,
  ) => Promise<WaitlistBatchEntry[]>;
  startOnboardingForActivatedUser: (input: {
    user_id: string;
    profile_id: string;
    waitlist_entry_id: string;
    idempotency_key: string;
    activated_at: string;
  }) => Promise<EnqueueResult>;
};

export class WaitlistBatchNotifyError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "WaitlistBatchNotifyError";
    this.status = status;
    this.code = code;
  }
}

export function parseWaitlistBatchNotifyRequest(
  payload: unknown,
): WaitlistBatchNotifyRequest {
  if (!isRecord(payload)) {
    throw new WaitlistBatchNotifyError(
      400,
      "INVALID_REQUEST",
      "Request body must be a JSON object.",
    );
  }

  const regionSlugRaw = payload.region_slug;
  if (typeof regionSlugRaw !== "string" || regionSlugRaw.trim().length === 0) {
    throw new WaitlistBatchNotifyError(
      400,
      "INVALID_REQUEST",
      "`region_slug` is required and must be a non-empty string.",
    );
  }

  const limit = parseBatchLimit(payload.limit);
  const dryRun = parseBooleanField(payload.dry_run, "dry_run", false);
  const openRegion = parseBooleanField(payload.open_region, "open_region", false);
  const templateVersion = parseTemplateVersion(payload.notification_template_version);

  return {
    region_slug: regionSlugRaw.trim().toLowerCase(),
    limit,
    dry_run: dryRun,
    open_region: openRegion,
    notification_template_version: templateVersion,
  };
}

export function renderWaitlistNotificationTemplate(input: {
  version: NotificationTemplateVersion;
  regionDisplayName: string | null;
}): string {
  switch (input.version) {
    case "v1": {
      const label = input.regionDisplayName?.trim() || "your area";
      return `JOSH is now live in ${label}. You're off the waitlist. Reply START to continue onboarding. [template:v1]`;
    }
    default:
      throw new WaitlistBatchNotifyError(
        400,
        "INVALID_TEMPLATE_VERSION",
        "Unsupported notification template version.",
      );
  }
}

export function buildWaitlistNotificationIdempotencyKey(input: {
  regionId: string;
  profileId: string;
  templateVersion: NotificationTemplateVersion;
}): string {
  return `waitlist_activation_onboarding:${input.regionId}:${input.profileId}:${input.templateVersion}`;
}

export function resolveRegionBySlug(
  regions: WaitlistBatchRegion[],
  regionSlug: string,
): WaitlistBatchRegion | null {
  const normalized = regionSlug.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return regions.find((region) => region.slug === normalized) ?? null;
}

export function selectEligibleWaitlistEntries(
  entries: WaitlistBatchEntry[],
  limit: number,
): WaitlistBatchEntry[] {
  return entries
    .filter((entry) =>
      ELIGIBLE_WAITLIST_STATUSES.includes(entry.status as EligibleWaitlistStatus) &&
      !entry.last_notified_at
    )
    .sort(compareWaitlistEntries)
    .slice(0, clampLimit(limit));
}

export function claimWaitlistEntriesCas(
  entries: WaitlistBatchEntry[],
  selectionIds: string[],
  claimedAtIso: string,
): {
  claimed: WaitlistBatchEntry[];
  updated_entries: WaitlistBatchEntry[];
} {
  const selected = new Set(selectionIds);
  const claimed: WaitlistBatchEntry[] = [];

  const updatedEntries = entries.map((entry) => {
    if (!selected.has(entry.id)) {
      return entry;
    }
    if (entry.last_notified_at) {
      return entry;
    }
    if (!ELIGIBLE_WAITLIST_STATUSES.includes(entry.status as EligibleWaitlistStatus)) {
      return entry;
    }

    const claimedEntry: WaitlistBatchEntry = {
      ...entry,
      status: "activated",
      last_notified_at: claimedAtIso,
      notified_at: entry.notified_at ?? claimedAtIso,
      updated_at: claimedAtIso,
    };
    claimed.push(claimedEntry);
    return claimedEntry;
  });

  return {
    claimed,
    updated_entries: updatedEntries,
  };
}

export async function executeWaitlistBatchNotify(params: {
  request: WaitlistBatchNotifyRequest;
  repository: WaitlistBatchNotifyRepository;
  now?: () => Date;
}): Promise<WaitlistBatchNotifySummary> {
  const now = params.now ?? (() => new Date());
  const nowIso = now().toISOString();
  const errors: WaitlistBatchNotifySummary["errors"] = [];

  const region = await params.repository.findRegionBySlug(params.request.region_slug);
  if (!region) {
    throw new WaitlistBatchNotifyError(
      404,
      "REGION_NOT_FOUND",
      `Unknown region slug '${params.request.region_slug}'.`,
    );
  }

  let openRegionApplied = false;
  if (params.request.open_region && !params.request.dry_run) {
    openRegionApplied = await params.repository.openRegion(region.id);
  }

  const selected = await params.repository.selectEligibleEntries(
    region.id,
    params.request.limit,
  );
  const selectedCount = selected.length;

  if (params.request.dry_run) {
    return {
      region_slug: region.slug,
      open_region_applied: false,
      dry_run: true,
      selected_count: selectedCount,
      claimed_count: 0,
      attempted_send_count: 0,
      sent_count: 0,
      skipped_already_notified_count: 0,
      errors,
    };
  }

  if (selectedCount === 0) {
    return {
      region_slug: region.slug,
      open_region_applied: openRegionApplied,
      dry_run: false,
      selected_count: 0,
      claimed_count: 0,
      attempted_send_count: 0,
      sent_count: 0,
      skipped_already_notified_count: 0,
      errors,
    };
  }

  const selectedIds = selected.map((entry) => entry.id);
  const claimedUnordered = await params.repository.claimEntries(
    region.id,
    selectedIds,
    nowIso,
  );
  const claimed = reorderBySelection(claimedUnordered, selectedIds);

  const claimedCount = claimed.length;
  const skippedAlreadyNotifiedCount = Math.max(0, selectedCount - claimedCount);
  if (claimedCount === 0) {
    return {
      region_slug: region.slug,
      open_region_applied: openRegionApplied,
      dry_run: false,
      selected_count: selectedCount,
      claimed_count: 0,
      attempted_send_count: 0,
      sent_count: 0,
      skipped_already_notified_count: skippedAlreadyNotifiedCount,
      errors,
    };
  }

  let attemptedSendCount = 0;
  let sentCount = 0;

  for (const entry of claimed) {
    attemptedSendCount += 1;
    try {
      const enqueueResult = await params.repository.startOnboardingForActivatedUser({
        user_id: entry.user_id,
        profile_id: entry.profile_id,
        waitlist_entry_id: entry.id,
        idempotency_key: buildWaitlistNotificationIdempotencyKey({
          regionId: entry.region_id,
          profileId: entry.profile_id,
          templateVersion: params.request.notification_template_version,
        }),
        activated_at: nowIso,
      });

      if (enqueueResult === "inserted" || enqueueResult === "duplicate") {
        sentCount += 1;
      }
    } catch (error) {
      errors.push({
        code: "SEND_ENQUEUE_FAILED",
        message: redactOperationalErrorMessage(
          (error as Error)?.message ?? "Failed to enqueue waitlist notification.",
        ),
        entry_id: entry.id,
      });
    }
  }

  return {
    region_slug: region.slug,
    open_region_applied: openRegionApplied,
    dry_run: false,
    selected_count: selectedCount,
    claimed_count: claimedCount,
    attempted_send_count: attemptedSendCount,
    sent_count: sentCount,
    skipped_already_notified_count: skippedAlreadyNotifiedCount,
    errors,
  };
}

function parseBatchLimit(value: unknown): number {
  if (value === undefined || value === null) {
    return DEFAULT_WAITLIST_BATCH_LIMIT;
  }

  const numeric = typeof value === "number"
    ? value
    : (typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN);

  if (!Number.isFinite(numeric) || Number.isNaN(numeric)) {
    throw new WaitlistBatchNotifyError(
      400,
      "INVALID_REQUEST",
      "`limit` must be an integer.",
    );
  }

  return clampLimit(numeric);
}

function clampLimit(limit: number): number {
  const normalized = Math.trunc(limit);
  if (normalized < 1) {
    return 1;
  }
  if (normalized > MAX_WAITLIST_BATCH_LIMIT) {
    return MAX_WAITLIST_BATCH_LIMIT;
  }
  return normalized;
}

function parseBooleanField(
  raw: unknown,
  fieldName: string,
  defaultValue: boolean,
): boolean {
  if (raw === undefined || raw === null) {
    return defaultValue;
  }
  if (typeof raw !== "boolean") {
    throw new WaitlistBatchNotifyError(
      400,
      "INVALID_REQUEST",
      `\`${fieldName}\` must be a boolean.`,
    );
  }
  return raw;
}

function parseTemplateVersion(raw: unknown): NotificationTemplateVersion {
  if (raw === undefined || raw === null) {
    return "v1";
  }
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new WaitlistBatchNotifyError(
      400,
      "INVALID_REQUEST",
      "`notification_template_version` must be a non-empty string.",
    );
  }

  const normalized = raw.trim().toLowerCase();
  if (
    !SUPPORTED_NOTIFICATION_TEMPLATE_VERSIONS.includes(
      normalized as NotificationTemplateVersion,
    )
  ) {
    throw new WaitlistBatchNotifyError(
      400,
      "INVALID_TEMPLATE_VERSION",
      `Unsupported notification template version '${normalized}'.`,
    );
  }
  return normalized as NotificationTemplateVersion;
}

function compareWaitlistEntries(a: WaitlistBatchEntry, b: WaitlistBatchEntry): number {
  const createdAtDiff = a.created_at.localeCompare(b.created_at);
  if (createdAtDiff !== 0) {
    return createdAtDiff;
  }
  return a.id.localeCompare(b.id);
}

function reorderBySelection(
  entries: WaitlistBatchEntry[],
  selectedIds: string[],
): WaitlistBatchEntry[] {
  const byId = new Map<string, WaitlistBatchEntry>();
  for (const entry of entries) {
    byId.set(entry.id, entry);
  }
  const ordered: WaitlistBatchEntry[] = [];
  for (const id of selectedIds) {
    const entry = byId.get(id);
    if (entry) {
      ordered.push(entry);
    }
  }
  return ordered;
}

function redactOperationalErrorMessage(message: string): string {
  if (!message) {
    return "Unexpected operational error.";
  }
  return message
    .replace(/[A-Za-z0-9_=-]{24,}/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
