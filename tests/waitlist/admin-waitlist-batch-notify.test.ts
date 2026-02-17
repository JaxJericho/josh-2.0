import { describe, expect, it } from "vitest";
import {
  claimWaitlistEntriesCas,
  executeWaitlistBatchNotify,
  parseWaitlistBatchNotifyRequest,
  resolveRegionBySlug,
  selectEligibleWaitlistEntries,
  WaitlistBatchNotifyError,
  type EnqueueResult,
  type WaitlistBatchEntry,
  type WaitlistBatchNotifyRepository,
  type WaitlistBatchNotifyRequest,
  type WaitlistBatchRegion,
} from "../../supabase/functions/_shared/waitlist/admin-waitlist-batch-notify";

describe("admin waitlist batch notify", () => {
  it("selection logic keeps only eligible rows with last_notified_at=null in deterministic order", () => {
    const entries: WaitlistBatchEntry[] = [
      entry({
        id: "w3",
        status: "waiting",
        created_at: "2026-02-17T01:00:00.000Z",
        last_notified_at: "2026-02-17T02:00:00.000Z",
      }),
      entry({
        id: "w2",
        status: "onboarded",
        created_at: "2026-02-17T00:01:00.000Z",
      }),
      entry({
        id: "w1",
        status: "waiting",
        created_at: "2026-02-17T00:01:00.000Z",
      }),
      entry({
        id: "w4",
        status: "removed",
        created_at: "2026-02-17T00:00:00.000Z",
      }),
    ];

    const selected = selectEligibleWaitlistEntries(entries, 10);
    expect(selected.map((row) => row.id)).toEqual(["w1", "w2"]);
  });

  it("CAS claim is replay-safe: first run claims N and second run claims 0", () => {
    const initial: WaitlistBatchEntry[] = [
      entry({ id: "a", status: "waiting" }),
      entry({ id: "b", status: "onboarded" }),
      entry({
        id: "c",
        status: "waiting",
        last_notified_at: "2026-02-16T00:00:00.000Z",
      }),
    ];

    const first = claimWaitlistEntriesCas(
      initial,
      ["a", "b", "c"],
      "2026-02-17T03:00:00.000Z",
    );
    expect(first.claimed.map((row) => row.id)).toEqual(["a", "b"]);

    const second = claimWaitlistEntriesCas(
      first.updated_entries,
      ["a", "b"],
      "2026-02-17T04:00:00.000Z",
    );
    expect(second.claimed).toHaveLength(0);
  });

  it("resolves region slugs deterministically", () => {
    const regions: WaitlistBatchRegion[] = [
      {
        id: "reg_wa",
        slug: "us-wa",
        display_name: "Washington",
        is_active: true,
      },
      {
        id: "reg_waitlist",
        slug: "waitlist",
        display_name: "Waitlist",
        is_active: false,
      },
    ];

    expect(resolveRegionBySlug(regions, "WAITLIST")?.id).toBe("reg_waitlist");
    expect(resolveRegionBySlug(regions, "unknown")).toBeNull();
  });

  it("executes dry_run + non-dry-run and remains replay-safe", async () => {
    const repository = new InMemoryWaitlistRepository({
      regions: [
        {
          id: "reg_waitlist",
          slug: "waitlist",
          display_name: "Waitlist",
          is_active: false,
        },
      ],
      entries: [
        entry({
          id: "w1",
          profile_id: "pro_1",
          user_id: "usr_1",
          region_id: "reg_waitlist",
          status: "waiting",
          created_at: "2026-02-17T00:00:00.000Z",
        }),
        entry({
          id: "w2",
          profile_id: "pro_2",
          user_id: "usr_2",
          region_id: "reg_waitlist",
          status: "onboarded",
          created_at: "2026-02-17T00:01:00.000Z",
        }),
      ],
      userPhones: new Map([
        ["usr_1", "+15550000001"],
        ["usr_2", "+15550000002"],
      ]),
    });

    const dryRun = await executeWaitlistBatchNotify({
      request: request({
        region_slug: "waitlist",
        limit: 5,
        dry_run: true,
        open_region: true,
      }),
      repository,
      now: () => new Date("2026-02-17T01:00:00.000Z"),
    });

    expect(dryRun.open_region_applied).toBe(false);
    expect(dryRun.selected_count).toBe(2);
    expect(dryRun.claimed_count).toBe(0);
    expect(dryRun.sent_count).toBe(0);

    const firstLiveRun = await executeWaitlistBatchNotify({
      request: request({
        region_slug: "waitlist",
        limit: 5,
        dry_run: false,
        open_region: true,
      }),
      repository,
      now: () => new Date("2026-02-17T02:00:00.000Z"),
    });

    expect(firstLiveRun.open_region_applied).toBe(true);
    expect(firstLiveRun.selected_count).toBe(2);
    expect(firstLiveRun.claimed_count).toBe(2);
    expect(firstLiveRun.attempted_send_count).toBe(2);
    expect(firstLiveRun.sent_count).toBe(2);
    expect(firstLiveRun.errors).toHaveLength(0);

    const replayRun = await executeWaitlistBatchNotify({
      request: request({
        region_slug: "waitlist",
        limit: 5,
        dry_run: false,
        open_region: false,
      }),
      repository,
      now: () => new Date("2026-02-17T03:00:00.000Z"),
    });

    expect(replayRun.selected_count).toBe(0);
    expect(replayRun.claimed_count).toBe(0);
    expect(replayRun.sent_count).toBe(0);
  });

  it("returns REGION_NOT_FOUND for unknown region_slug", async () => {
    const repository = new InMemoryWaitlistRepository({
      regions: [],
      entries: [],
      userPhones: new Map(),
    });

    await expect(
      executeWaitlistBatchNotify({
        request: request({
          region_slug: "does-not-exist",
        }),
        repository,
      }),
    ).rejects.toMatchObject({
      status: 404,
      code: "REGION_NOT_FOUND",
    } as Partial<WaitlistBatchNotifyError>);
  });
});

class InMemoryWaitlistRepository implements WaitlistBatchNotifyRepository {
  private regions: WaitlistBatchRegion[];
  private entries: WaitlistBatchEntry[];
  private userPhones: Map<string, string>;
  private outboundKeys: Set<string>;

  constructor(input: {
    regions: WaitlistBatchRegion[];
    entries: WaitlistBatchEntry[];
    userPhones: Map<string, string>;
  }) {
    this.regions = input.regions.map((region) => ({ ...region }));
    this.entries = input.entries.map((row) => ({ ...row }));
    this.userPhones = new Map(input.userPhones);
    this.outboundKeys = new Set<string>();
  }

  async findRegionBySlug(slug: string): Promise<WaitlistBatchRegion | null> {
    return resolveRegionBySlug(this.regions, slug);
  }

  async openRegion(regionId: string): Promise<boolean> {
    const region = this.regions.find((candidate) => candidate.id === regionId);
    if (!region) {
      return false;
    }
    if (region.is_active) {
      return false;
    }
    region.is_active = true;
    return true;
  }

  async selectEligibleEntries(
    regionId: string,
    limit: number,
  ): Promise<WaitlistBatchEntry[]> {
    const inRegion = this.entries.filter((entry) => entry.region_id === regionId);
    return selectEligibleWaitlistEntries(inRegion, limit);
  }

  async claimEntries(
    _regionId: string,
    entryIds: string[],
    claimedAtIso: string,
  ): Promise<WaitlistBatchEntry[]> {
    const claim = claimWaitlistEntriesCas(this.entries, entryIds, claimedAtIso);
    this.entries = claim.updated_entries;
    return claim.claimed;
  }

  async getUserPhones(userIds: string[]): Promise<Map<string, string>> {
    const subset = new Map<string, string>();
    for (const userId of userIds) {
      const phone = this.userPhones.get(userId);
      if (phone) {
        subset.set(userId, phone);
      }
    }
    return subset;
  }

  async encryptBody(plaintext: string): Promise<string> {
    return `cipher:${plaintext}`;
  }

  async enqueueWaitlistNotificationJob(input: {
    user_id: string;
    to_e164: string;
    body_ciphertext: string;
    idempotency_key: string;
    run_at: string;
  }): Promise<EnqueueResult> {
    if (!this.outboundKeys.has(input.idempotency_key)) {
      this.outboundKeys.add(input.idempotency_key);
      return "inserted";
    }
    return "duplicate";
  }
}

function entry(
  input: Partial<WaitlistBatchEntry> & Pick<WaitlistBatchEntry, "id" | "status">,
): WaitlistBatchEntry {
  return {
    id: input.id,
    profile_id: input.profile_id ?? `profile_${input.id}`,
    user_id: input.user_id ?? `user_${input.id}`,
    region_id: input.region_id ?? "reg_waitlist",
    status: input.status,
    created_at: input.created_at ?? "2026-02-17T00:00:00.000Z",
    last_notified_at: input.last_notified_at ?? null,
    notified_at: input.notified_at ?? null,
    updated_at: input.updated_at ?? null,
  };
}

function request(input: Partial<WaitlistBatchNotifyRequest>): WaitlistBatchNotifyRequest {
  return parseWaitlistBatchNotifyRequest({
    region_slug: input.region_slug ?? "waitlist",
    limit: input.limit,
    dry_run: input.dry_run,
    open_region: input.open_region,
    notification_template_version: input.notification_template_version ?? "v1",
  });
}
