import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const E2E_CANDIDATE_A_USER_ID = "77777777-7777-4777-8777-777777777822";
const E2E_CANDIDATE_B_USER_ID = "77777777-7777-4777-8777-777777777823";
const E2E_CANDIDATE_C_USER_ID = "77777777-7777-4777-8777-777777777824";
const E2E_CANDIDATE_D_USER_ID = "77777777-7777-4777-8777-777777777825";

const PHONE_BY_USER_ID = {
  [E2E_CANDIDATE_A_USER_ID]: "+15559772002",
  [E2E_CANDIDATE_B_USER_ID]: "+15559772003",
  [E2E_CANDIDATE_C_USER_ID]: "+15559772004",
  [E2E_CANDIDATE_D_USER_ID]: "+15559772005",
};

const DESTINATION_E164 = "+15559990000";

loadDotEnv(".env.local");

const args = parseArgs(process.argv.slice(2));
const stagingDbDsn = requiredEnvAny(["STAGING_DB_DSN", "STAGING_DB_URL"]);
const linkupId = args.linkupId ?? resolveLatestLinkupId(stagingDbDsn);

const inviteMap = fetchInviteMap(stagingDbDsn, linkupId);
if (!inviteMap[E2E_CANDIDATE_A_USER_ID] || !inviteMap[E2E_CANDIDATE_B_USER_ID] || !inviteMap[E2E_CANDIDATE_D_USER_ID]) {
  fail("Expected wave-1 invites for candidates A, B, and D before running E2E flow.");
}

const before = snapshot(stagingDbDsn, linkupId);

const acceptA = applyReply({
  dsn: stagingDbDsn,
  linkupId,
  userId: E2E_CANDIDATE_A_USER_ID,
  text: "YES",
  label: "accept_a",
});

const declineB = applyReply({
  dsn: stagingDbDsn,
  linkupId,
  userId: E2E_CANDIDATE_B_USER_ID,
  text: "NO",
  label: "decline_b",
});

const waveTwoInviteCount = querySingleValue({
  dsn: stagingDbDsn,
  sql: `
    select count(*)::text
    from public.linkup_invites
    where linkup_id = '${linkupId}'::uuid
      and wave_no = 2;
  `,
});

const beforeDuplicate = snapshot(stagingDbDsn, linkupId);

const duplicateAcceptSid = `SM_LINKUP_E2E_DUP_${Date.now()}`;
const duplicateAcceptFirst = applyReply({
  dsn: stagingDbDsn,
  linkupId,
  userId: E2E_CANDIDATE_A_USER_ID,
  text: "Y",
  label: "duplicate_accept_a_first",
  messageSid: duplicateAcceptSid,
});
const duplicateAcceptReplay = applyReply({
  dsn: stagingDbDsn,
  linkupId,
  userId: E2E_CANDIDATE_A_USER_ID,
  text: "Y",
  label: "duplicate_accept_a_replay",
  messageSid: duplicateAcceptSid,
});

const afterDuplicate = snapshot(stagingDbDsn, linkupId);

const inviteCAvailable = querySingleValue({
  dsn: stagingDbDsn,
  sql: `
    select count(*)::text
    from public.linkup_invites
    where linkup_id = '${linkupId}'::uuid
      and invited_user_id = '${E2E_CANDIDATE_C_USER_ID}'::uuid;
  `,
});

if (inviteCAvailable !== "1") {
  fail("Expected replacement wave invite for candidate C after decline.");
}

const acceptC = applyReply({
  dsn: stagingDbDsn,
  linkupId,
  userId: E2E_CANDIDATE_C_USER_ID,
  text: "YES",
  label: "accept_c",
});

const afterLock = snapshot(stagingDbDsn, linkupId);

const acceptAfterLockD = applyReply({
  dsn: stagingDbDsn,
  linkupId,
  userId: E2E_CANDIDATE_D_USER_ID,
  text: "YES",
  label: "accept_after_lock_d",
});

const finalSnapshot = snapshot(stagingDbDsn, linkupId);

const inviteRows = querySingleValue({
  dsn: stagingDbDsn,
  sql: `
    select coalesce(
      string_agg(
        invited_user_id::text || ':' || wave_no::text || ':' || state::text || ':' || coalesce(terminal_reason, ''),
        ';' order by wave_no, created_at, invited_user_id
      ),
      ''
    )
    from public.linkup_invites
    where linkup_id = '${linkupId}'::uuid;
  `,
});

const memberRows = querySingleValue({
  dsn: stagingDbDsn,
  sql: `
    select coalesce(
      string_agg(user_id::text || ':' || role::text || ':' || status::text, ';' order by role, user_id),
      ''
    )
    from public.linkup_members
    where linkup_id = '${linkupId}'::uuid;
  `,
});

const lockEventCount = Number.parseInt(finalSnapshot.lock_event_count, 10);
const duplicateAcceptNoStateChange =
  beforeDuplicate.accepted_count === afterDuplicate.accepted_count &&
  beforeDuplicate.member_count === afterDuplicate.member_count &&
  beforeDuplicate.closed_count === afterDuplicate.closed_count;

const lateAcceptNoMembershipChange = afterLock.member_count === finalSnapshot.member_count;
const lockOccursOnce = Number.isFinite(lockEventCount) && lockEventCount === 1;
const replacementWaveCreated = Number.parseInt(waveTwoInviteCount, 10) >= 1;
const duplicateReplayCaptured = duplicateAcceptReplay.status === "duplicate_replay";

const idempotentReplay =
  duplicateAcceptNoStateChange &&
  duplicateReplayCaptured &&
  lateAcceptNoMembershipChange &&
  lockOccursOnce;

console.log(`[linkup-e2e] linkup_id=${linkupId}`);
console.log(`[linkup-e2e] invites_before=${before.invite_total}`);
console.log(`[linkup-e2e] invites_after=${finalSnapshot.invite_total}`);
console.log(`[linkup-e2e] members_before=${before.member_count}`);
console.log(`[linkup-e2e] members_after=${finalSnapshot.member_count}`);
console.log(`[linkup-e2e] locked_at=${finalSnapshot.locked_at}`);
console.log(`[linkup-e2e] lock_event_count=${finalSnapshot.lock_event_count}`);
console.log(`[linkup-e2e] wave_2_invites=${waveTwoInviteCount}`);
console.log(`[linkup-e2e] accept_a_status=${acceptA.status}`);
console.log(`[linkup-e2e] decline_b_status=${declineB.status}`);
console.log(`[linkup-e2e] duplicate_accept_first_status=${duplicateAcceptFirst.status}`);
console.log(`[linkup-e2e] duplicate_accept_replay_status=${duplicateAcceptReplay.status}`);
console.log(`[linkup-e2e] accept_c_status=${acceptC.status}`);
console.log(`[linkup-e2e] accept_after_lock_status=${acceptAfterLockD.status}`);
console.log(`[linkup-e2e] replacement_wave_created=${replacementWaveCreated}`);
console.log(`[linkup-e2e] quorum_lock_once=${lockOccursOnce}`);
console.log(`[linkup-e2e] duplicate_accept_no_state_change=${duplicateAcceptNoStateChange}`);
console.log(`[linkup-e2e] late_accept_no_membership_change=${lateAcceptNoMembershipChange}`);
console.log(`[linkup-e2e] idempotent_replay=${idempotentReplay}`);
console.log(`[linkup-e2e] invite_rows=${encodeForSingleLine(inviteRows)}`);
console.log(`[linkup-e2e] member_rows=${encodeForSingleLine(memberRows)}`);
console.log("[linkup-e2e] done=true");

function parseArgs(rawArgs) {
  const parsed = {
    linkupId: null,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const token = rawArgs[index];
    const next = rawArgs[index + 1];

    if (token === "--linkup-id") {
      if (!next) {
        fail("Missing value for --linkup-id.");
      }
      parsed.linkupId = next;
      index += 1;
      continue;
    }

    fail(`Unknown argument '${token}'.`);
  }

  return parsed;
}

function resolveLatestLinkupId(dsn) {
  return querySingleValue({
    dsn,
    sql: `
      select id::text
      from public.linkups
      where linkup_create_key like 'ticket_7_2_linkup_e2e_%'
      order by created_at desc
      limit 1;
    `,
  });
}

function fetchInviteMap(dsn, linkupId) {
  const rows = queryMultiValue({
    dsn,
    sql: `
      select invited_user_id::text || '|' || id::text
      from public.linkup_invites
      where linkup_id = '${linkupId}'::uuid;
    `,
  });

  const map = {};
  for (const row of rows) {
    const [userId, inviteId] = row.split("|");
    if (userId && inviteId) {
      map[userId] = inviteId;
    }
  }
  return map;
}

function snapshot(dsn, linkupId) {
  const row = querySingleValue({
    dsn,
    sql: `
      select concat_ws(
        '|',
        count(*)::text,
        count(*) filter (where state = 'pending')::text,
        count(*) filter (where state = 'accepted')::text,
        count(*) filter (where state = 'declined')::text,
        count(*) filter (where state = 'closed')::text,
        count(*) filter (where state = 'expired')::text,
        (
          select count(*)::text
          from public.linkup_members m
          where m.linkup_id = '${linkupId}'::uuid
        ),
        (
          select coalesce(locked_at::text, '')
          from public.linkups l
          where l.id = '${linkupId}'::uuid
        ),
        (
          select count(*)::text
          from public.linkup_events e
          where e.linkup_id = '${linkupId}'::uuid
            and e.event_type = 'locked'
        )
      )
      from public.linkup_invites
      where linkup_id = '${linkupId}'::uuid;
    `,
  });

  const [
    inviteTotal,
    pendingCount,
    acceptedCount,
    declinedCount,
    closedCount,
    expiredCount,
    memberCount,
    lockedAt,
    lockEventCount,
  ] = row.split("|");

  return {
    invite_total: inviteTotal,
    pending_count: pendingCount,
    accepted_count: acceptedCount,
    declined_count: declinedCount,
    closed_count: closedCount,
    expired_count: expiredCount,
    member_count: memberCount,
    locked_at: lockedAt,
    lock_event_count: lockEventCount,
  };
}

function applyReply(params) {
  const messageSid = params.messageSid ?? `SM_LINKUP_E2E_${params.label}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const fromE164 = PHONE_BY_USER_ID[params.userId];
  if (!fromE164) {
    fail(`No phone mapping for user ${params.userId}`);
  }

  const rawResult = querySingleValue({
    dsn: params.dsn,
    sql: `
      with inbound as (
        insert into public.sms_messages (
          user_id,
          direction,
          from_e164,
          to_e164,
          twilio_message_sid,
          body_ciphertext,
          key_version,
          media_count,
          status
        )
        values (
          '${params.userId}'::uuid,
          'in',
          '${fromE164}',
          '${DESTINATION_E164}',
          '${messageSid}',
          null,
          1,
          0,
          'received'
        )
        on conflict (twilio_message_sid) where twilio_message_sid is not null do update set
          updated_at = now()
        returning id
      )
      select public.linkup_apply_invite_reply(
        '${params.userId}'::uuid,
        '${params.linkupId}'::uuid,
        (select id from inbound),
        '${messageSid}',
        '${escapeSqlLiteral(params.text)}',
        now()
      )::text;
    `,
  });

  let parsed;
  try {
    parsed = JSON.parse(rawResult);
  } catch {
    fail(`Unable to parse reply payload for ${params.label}: ${rawResult}`);
  }

  return {
    message_sid: messageSid,
    status: parsed.status ?? "unknown",
    payload: parsed,
  };
}

function escapeSqlLiteral(value) {
  return String(value).replace(/'/g, "''");
}

function querySingleValue(params) {
  const result = spawnSync(
    "psql",
    [params.dsn, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", params.sql],
    {
      encoding: "utf8",
      stdio: "pipe",
    },
  );

  if (result.status !== 0) {
    fail(`psql query failed: ${truncate(result.stderr || result.stdout || "unknown error", 1000)}`);
  }

  const value = (result.stdout || "").trim();
  if (value.length === 0) {
    fail("psql query returned empty output.");
  }

  return value;
}

function queryMultiValue(params) {
  const result = spawnSync(
    "psql",
    [params.dsn, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", params.sql],
    {
      encoding: "utf8",
      stdio: "pipe",
    },
  );

  if (result.status !== 0) {
    fail(`psql query failed: ${truncate(result.stderr || result.stdout || "unknown error", 1000)}`);
  }

  return (result.stdout || "")
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    fail(`Missing required env var: ${name}`);
  }
  return value.trim();
}

function requiredEnvAny(names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim().length > 0) {
      return value.trim();
    }
  }
  fail(`Missing required env var. Expected one of: ${names.join(", ")}`);
}

function loadDotEnv(relativePath) {
  const fullPath = path.join(process.cwd(), relativePath);
  if (!fs.existsSync(fullPath)) {
    return;
  }

  const raw = fs.readFileSync(fullPath, "utf8");
  for (const line of raw.split("\n")) {
    const parsed = parseDotEnvLine(line);
    if (!parsed) {
      continue;
    }
    if (!process.env[parsed.key]) {
      process.env[parsed.key] = parsed.value;
    }
  }
}

function parseDotEnvLine(line) {
  if (!line || line.trim().length === 0 || line.trim().startsWith("#")) {
    return null;
  }

  const splitIndex = line.indexOf("=");
  if (splitIndex <= 0) {
    return null;
  }

  const key = line.slice(0, splitIndex).trim();
  if (!/^[A-Z0-9_]+$/.test(key)) {
    return null;
  }

  let value = line.slice(splitIndex + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return { key, value };
}

function encodeForSingleLine(value) {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value, maxLength) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}

function fail(message) {
  console.error(`[linkup-e2e] ERROR: ${message}`);
  process.exit(1);
}
