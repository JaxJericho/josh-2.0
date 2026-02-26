// @ts-ignore: Deno runtime requires explicit file extensions for local imports.
import { createServiceRoleDbClient } from "../../../packages/db/src/client-deno.mjs";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { resolveTwilioRuntimeFromEnv } from "../../../packages/messaging/src/client.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { SendSmsError, sendSms } from "../../../packages/messaging/src/sender.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { INTERVIEW_DROPOUT_NUDGE } from "../../../packages/core/src/interview/messages.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { logEvent } from "../../../packages/core/src/observability/logger.ts";

type SmsOutboundJob = {
  id: string;
  user_id: string | null;
  to_e164: string;
  from_e164: string | null;
  body_ciphertext: string | null;
  body_iv: string | null;
  body_tag: string | null;
  key_version: number;
  idempotency_key: string;
  purpose: string;
  status: string;
  twilio_message_sid: string | null;
  attempts: number;
  next_attempt_at: string | null;
  run_at: string | null;
  last_error: string | null;
  correlation_id: string | null;
  created_at: string;
  updated_at: string;
};

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const LEASE_SECONDS = 60;
const MAX_ATTEMPTS = 5;
const BACKOFF_BASE_SECONDS = 30;
const BACKOFF_MAX_SECONDS = 480;

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  let phase = "start";

  try {
    phase = "method";
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method Not Allowed" }, 405);
    }

    phase = "auth";
    const authResponse = await verifyRunnerRequest(req);
    if (authResponse) {
      return authResponse;
    }

    const url = new URL(req.url);
    const limit = clampLimit(url.searchParams.get("limit"));

    phase = "env";
    const supabaseUrl = requireEnv("SUPABASE_URL");
    const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    const encryptionKey = requireEnv("SMS_BODY_ENCRYPTION_KEY");
    const twilio = resolveTwilioRuntimeFromEnv({
      getEnv: (name) => Deno.env.get(name) ?? undefined,
    });
    const twilioMessagingServiceSid = twilio.senderIdentity.messagingServiceSid;
    const twilioFromNumber = twilio.senderIdentity.from;
    const statusCallbackUrl = twilio.statusCallbackUrl;

    phase = "supabase_init";
    const supabase = createServiceRoleDbClient({
      env: {
        SUPABASE_URL: supabaseUrl,
        SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
      },
    });

    phase = "dropout_nudges";
    let dropoutNudgeEnqueued = 0;
    const { data: dropoutResult, error: dropoutError } = await supabase.rpc(
      "enqueue_interview_dropout_nudges",
      {
        p_nudge_template: INTERVIEW_DROPOUT_NUDGE,
        p_sms_encryption_key: encryptionKey,
      }
    );
    if (dropoutError) {
      logEvent({
        level: "error",
        event: "interview_dropout.enqueue_failed",
        correlation_id: requestId,
        payload: {
          request_id: requestId,
          error_message: dropoutError.message,
        },
      });
    } else {
      const result = (dropoutResult ?? {}) as Record<string, unknown>;
      const enqueuedRaw = result.enqueued_count;
      if (typeof enqueuedRaw === "number" && Number.isFinite(enqueuedRaw)) {
        dropoutNudgeEnqueued = Math.max(0, Math.trunc(enqueuedRaw));
      }
      logEvent({
        event: "interview_dropout.enqueue_summary",
        correlation_id: requestId,
        payload: {
          request_id: requestId,
          candidate_count: result.candidate_count ?? 0,
          marked_count: result.marked_count ?? 0,
          enqueued_count: dropoutNudgeEnqueued,
        },
      });
    }

    phase = "claim";
    const { data: jobs, error: claimError } = await supabase.rpc(
      "claim_sms_outbound_jobs",
      {
        max_jobs: limit,
        lease_seconds: LEASE_SECONDS,
      }
    );

    if (claimError) {
      logEvent({
        level: "error",
        event: "sms_outbound.claim_failed",
        correlation_id: requestId,
        payload: {
          request_id: requestId,
          error_message: claimError.message,
        },
      });
      return jsonResponse({ error: "Failed to claim jobs" }, 500);
    }

    const claimedJobs = (jobs ?? []) as SmsOutboundJob[];
    if (claimedJobs.length === 0) {
      return jsonResponse({
        ok: true,
        processed: 0,
        sent: 0,
        failed: 0,
        dropout_nudge_enqueued: dropoutNudgeEnqueued,
      }, 200);
    }

    let sent = 0;
    let failed = 0;

    for (const job of claimedJobs) {
      phase = "job";
      if (isTerminalStatus(job.status)) {
        continue;
      }

      // Guard against accidental early delivery if claim semantics drift.
      if (isFutureRunAt(job.run_at)) {
        await releaseFutureJob(supabase, job);
        continue;
      }

      if (job.twilio_message_sid) {
        await markJobSent(supabase, job, job.twilio_message_sid, null, false);
        await ensureSmsMessage(
          supabase,
          job,
          job.from_e164 ?? twilioFromNumber,
          job.twilio_message_sid,
          "sent"
        );
        continue;
      }

      if (!job.body_ciphertext) {
        failed += 1;
        await markJobFailure(
          supabase,
          job,
          "Missing encrypted body",
          false
        );
        continue;
      }

      const fromE164 = job.from_e164 ?? twilioFromNumber;
      if (!fromE164) {
        failed += 1;
        await markJobFailure(
          supabase,
          job,
          "Missing from_e164 (set job.from_e164 or TWILIO_FROM_NUMBER)",
          false
        );
        continue;
      }

      phase = "decrypt";
      const { data: plaintext, error: decryptError } = await supabase.rpc(
        "decrypt_sms_body",
        {
          ciphertext: job.body_ciphertext,
          key: encryptionKey,
        }
      );

      if (decryptError || !plaintext) {
        failed += 1;
        await markJobFailure(
          supabase,
          job,
          decryptError?.message ?? "Failed to decrypt body",
          false
        );
        continue;
      }

      // Pre-send recheck: verify the job is still in "sending" status and
      // has no twilio_message_sid. This prevents double-delivery when a
      // concurrent runner invocation or the onboarding engine has already
      // sent this job between claim and now.
      phase = "pre_send_verify";
      const freshStatus = await recheckJobBeforeSend(supabase, job.id);
      if (
        freshStatus === null ||
        freshStatus.status !== "sending" ||
        freshStatus.twilio_message_sid !== null
      ) {
        continue;
      }

      phase = "send";
      let sendResult:
        | Awaited<ReturnType<typeof sendSms>>
        | null = null;
      try {
        sendResult = await sendSms({
          client: twilio.client,
          db: supabase,
          to: job.to_e164,
          from: fromE164,
          body: plaintext as string,
          correlationId: job.correlation_id ?? job.idempotency_key,
          purpose: job.purpose,
          idempotencyKey: job.idempotency_key,
          userId: job.user_id,
          messagingServiceSid: twilioMessagingServiceSid,
          statusCallbackUrl,
          bodyCiphertext: job.body_ciphertext,
          bodyIv: job.body_iv,
          bodyTag: job.body_tag,
          keyVersion: job.key_version,
          mediaCount: 0,
        });
      } catch (error) {
        failed += 1;
        const sendError = error as Error;
        const retryable = error instanceof SendSmsError
          ? error.retryable
          : false;
        await markJobFailure(
          supabase,
          job,
          sendError?.message ?? "Twilio send failed",
          retryable
        );
        continue;
      }

      if (!sendResult) {
        failed += 1;
        await markJobFailure(supabase, job, "Twilio send failed", false);
        continue;
      }

      const twilioSid = sendResult.twilioMessageSid;
      sent += sendResult.deduplicated ? 0 : 1;

      await markJobSent(supabase, job, twilioSid, sendResult.status);
    }

    return jsonResponse({
      ok: true,
      processed: claimedJobs.length,
      sent,
      failed,
      dropout_nudge_enqueued: dropoutNudgeEnqueued,
    });
  } catch (error) {
    const err = error as Error;
    logEvent({
      level: "error",
      event: "system.unhandled_error",
      correlation_id: requestId,
      payload: {
        request_id: requestId,
        phase,
        error_name: err?.name ?? "Error",
        error_message: err?.message ?? String(error),
        stack: err?.stack ?? null,
      },
    });
    return jsonErrorResponse(error, requestId, phase);
  }
});

function clampLimit(value: string | null): number {
  if (!value) {
    return DEFAULT_LIMIT;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(MAX_LIMIT, parsed));
}

function isTerminalStatus(status: string): boolean {
  return status === "sent" || status === "failed" || status === "canceled";
}

async function recheckJobBeforeSend(
  supabase: ReturnType<typeof createServiceRoleDbClient>,
  jobId: string,
): Promise<{ status: string; twilio_message_sid: string | null } | null> {
  const { data, error } = await supabase
    .from("sms_outbound_jobs")
    .select("status,twilio_message_sid")
    .eq("id", jobId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return {
    status: data.status,
    twilio_message_sid: data.twilio_message_sid ?? null,
  };
}

async function markJobSent(
  supabase: ReturnType<typeof createServiceRoleDbClient>,
  job: SmsOutboundJob,
  sid: string,
  status: string | null,
  incrementAttempts = true
): Promise<void> {
  let updateQuery = supabase
    .from("sms_outbound_jobs")
    .update({
      status: "sent",
      twilio_message_sid: sid,
      last_error: null,
      last_status_at: new Date().toISOString(),
      attempts: incrementAttempts ? job.attempts + 1 : job.attempts,
      next_attempt_at: null,
    })
    .eq("id", job.id)
    .neq("status", "canceled");

  const { error } = await updateQuery;

  if (error) {
    logEvent({
      level: "error",
      event: "sms_outbound.job_update_failed",
      correlation_id: job.correlation_id ?? job.idempotency_key,
      user_id: job.user_id,
      payload: {
        job_id: job.id,
        error_message: error.message,
        status,
      },
    });
  }
}

function isFutureRunAt(runAt: string | null): boolean {
  if (!runAt) {
    return false;
  }
  const parsed = Date.parse(runAt);
  if (!Number.isFinite(parsed)) {
    return false;
  }
  return parsed > Date.now();
}

async function releaseFutureJob(
  supabase: ReturnType<typeof createServiceRoleDbClient>,
  job: SmsOutboundJob
): Promise<void> {
  logEvent({
    event: "sms_outbound.future_job_released",
    correlation_id: job.correlation_id ?? job.idempotency_key,
    user_id: job.user_id,
    payload: {
      job_id: job.id,
      run_at: job.run_at,
      purpose: job.purpose,
    },
  });

  const { error } = await supabase
    .from("sms_outbound_jobs")
    .update({
      status: "pending",
      next_attempt_at: null,
      last_error: null,
    })
    .eq("id", job.id)
    .eq("status", "sending");

  if (error) {
    logEvent({
      level: "error",
      event: "sms_outbound.future_job_release_failed",
      correlation_id: job.correlation_id ?? job.idempotency_key,
      user_id: job.user_id,
      payload: {
        job_id: job.id,
        error_message: error.message,
      },
    });
  }
}

async function markJobFailure(
  supabase: ReturnType<typeof createServiceRoleDbClient>,
  job: SmsOutboundJob,
  errorMessage: string,
  retryable: boolean
): Promise<void> {
  const nextAttempt = job.attempts + 1;
  const shouldRetry = retryable && nextAttempt < MAX_ATTEMPTS;
  const nextAttemptAt = shouldRetry
    ? new Date(Date.now() + computeBackoffMs(nextAttempt)).toISOString()
    : null;

  const { error } = await supabase
    .from("sms_outbound_jobs")
    .update({
      status: shouldRetry ? "pending" : "failed",
      last_error: errorMessage,
      last_status_at: new Date().toISOString(),
      attempts: nextAttempt,
      next_attempt_at: nextAttemptAt,
    })
    .eq("id", job.id)
    .eq("status", "sending");

  if (error) {
    logEvent({
      level: "error",
      event: "sms_outbound.job_failure_update_failed",
      correlation_id: job.correlation_id ?? job.idempotency_key,
      user_id: job.user_id,
      payload: {
        job_id: job.id,
        error_message: error.message,
      },
    });
  }
}

async function ensureSmsMessage(
  supabase: ReturnType<typeof createServiceRoleDbClient>,
  job: SmsOutboundJob,
  fromE164: string | null,
  sid: string,
  status: string
): Promise<void> {
  if (!fromE164) {
    logEvent({
      level: "error",
      event: "sms_outbound.missing_from_for_message",
      correlation_id: job.correlation_id ?? job.idempotency_key,
      user_id: job.user_id,
      payload: { job_id: job.id },
    });
    return;
  }
  const { error } = await supabase
    .from("sms_messages")
    .insert(
      {
        user_id: job.user_id,
        direction: "out",
        from_e164: fromE164,
        to_e164: job.to_e164,
        twilio_message_sid: sid,
        body_ciphertext: job.body_ciphertext,
        body_iv: job.body_iv,
        body_tag: job.body_tag,
        key_version: job.key_version,
        media_count: 0,
        status,
        last_status_at: new Date().toISOString(),
        correlation_id: job.correlation_id,
      },
      { onConflict: "twilio_message_sid", ignoreDuplicates: true }
    );

  if (error) {
    logEvent({
      level: "error",
      event: "sms_outbound.sms_message_insert_failed",
      correlation_id: job.correlation_id ?? job.idempotency_key,
      user_id: job.user_id,
      payload: {
        job_id: job.id,
        error_message: error.message,
        twilio_sid: sid,
      },
    });
  }
}

function computeBackoffMs(attempt: number): number {
  const exp = Math.max(0, attempt - 1);
  const delaySeconds = Math.min(
    BACKOFF_MAX_SECONDS,
    BACKOFF_BASE_SECONDS * Math.pow(2, exp)
  );
  return delaySeconds * 1000;
}

function jsonResponse(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function jsonErrorResponse(
  error: unknown,
  requestId: string,
  phase: string
): Response {
  const missingEnv = extractMissingEnvName(error);
  const payload: Record<string, unknown> = {
    code: 500,
    message: missingEnv ? "Server misconfiguration" : "Internal error",
    request_id: requestId,
    phase,
  };
  if (missingEnv) {
    payload.missing_env = missingEnv;
  }
  return jsonResponse(payload, 500);
}

function extractMissingEnvName(error: unknown): string | null {
  const message = (error as { message?: string })?.message ?? "";
  const match = /Missing required env var: ([A-Z0-9_]+)/.exec(message);
  return match ? match[1] : null;
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

async function verifyRunnerRequest(req: Request): Promise<Response | null> {
  const hasUpstashSignatureHeader = Boolean(
    req.headers.get("Upstash-Signature") ?? req.headers.get("upstash-signature")
  );
  const runnerSecretHeader = req.headers.get("x-runner-secret") ?? "";
  const runnerSecret = Deno.env.get("QSTASH_RUNNER_SECRET") ?? "";

  // Canonical auth path: deterministic `x-runner-secret` only.
  if (runnerSecretHeader) {
    const ok = Boolean(runnerSecret) &&
      timingSafeEqual(runnerSecretHeader, runnerSecret);
    if (!ok) {
      return unauthorizedResponse({
        authBranch: "runner_secret_header",
        method: req.method,
        contentTypePresent: Boolean(req.headers.get("content-type")),
        hasUpstashSignatureHeader,
        hasRunnerSecretHeader: true,
        runnerSecretEnvPresent: Boolean(runnerSecret),
        runnerSecretMatches: Boolean(runnerSecret) &&
          timingSafeEqual(runnerSecretHeader, runnerSecret),
      });
    }
    return null;
  }

  return unauthorizedResponse({
    authBranch: "missing_auth",
    method: req.method,
    contentTypePresent: Boolean(req.headers.get("content-type")),
    hasUpstashSignatureHeader,
    hasRunnerSecretHeader: false,
    runnerSecretEnvPresent: Boolean(runnerSecret),
    runnerSecretMatches: false,
  });
}

function unauthorizedResponse(input: {
  authBranch: "runner_secret_header" | "missing_auth";
  method: string;
  contentTypePresent: boolean;
  hasUpstashSignatureHeader: boolean;
  hasRunnerSecretHeader: boolean;
  runnerSecretEnvPresent: boolean;
  runnerSecretMatches: boolean;
}): Response {
  return jsonResponse(
    {
      error: "Unauthorized",
      debug: {
        auth_branch: input.authBranch,
        method: input.method,
        content_type_present: input.contentTypePresent,
        has_upstash_signature_header: input.hasUpstashSignatureHeader,
        has_runner_secret_header: input.hasRunnerSecretHeader,
        runner_secret_env_present: input.runnerSecretEnvPresent,
        runner_secret_matches: input.runnerSecretMatches,
      },
    },
    401
  );
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
