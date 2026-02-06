import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4";
import { Receiver } from "https://esm.sh/@upstash/qstash@2.7.4?target=deno";

type SmsOutboundJob = {
  id: string;
  user_id: string | null;
  to_e164: string;
  from_e164: string | null;
  body_ciphertext: string | null;
  key_version: number;
  purpose: string;
  status: string;
  twilio_message_sid: string | null;
  attempts: number;
  next_attempt_at: string | null;
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
    const authResponse = await verifyQstashRequest(req);
    if (authResponse) {
      return authResponse;
    }

    const url = new URL(req.url);
    const limit = clampLimit(url.searchParams.get("limit"));

    phase = "env";
    const supabaseUrl = requireEnv("SUPABASE_URL");
    const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    const encryptionKey = requireEnv("SMS_BODY_ENCRYPTION_KEY");
    const twilioAccountSid = requireEnv("TWILIO_ACCOUNT_SID");
    const twilioAuthToken = requireEnv("TWILIO_AUTH_TOKEN");
    const twilioMessagingServiceSid = Deno.env.get("TWILIO_MESSAGING_SERVICE_SID") ?? null;
    const twilioFromNumber = Deno.env.get("TWILIO_FROM_NUMBER") ?? null;

    const statusCallbackUrl = resolveStatusCallbackUrl();

    phase = "supabase_init";
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    phase = "claim";
    const { data: jobs, error: claimError } = await supabase.rpc(
      "claim_sms_outbound_jobs",
      {
        max_jobs: limit,
        lease_seconds: LEASE_SECONDS,
      }
    );

    if (claimError) {
      console.error("sms_outbound.claim_failed", {
        request_id: requestId,
        error: claimError.message,
      });
      return jsonResponse({ error: "Failed to claim jobs" }, 500);
    }

    const claimedJobs = (jobs ?? []) as SmsOutboundJob[];
    if (claimedJobs.length === 0) {
      return jsonResponse({ ok: true, processed: 0, sent: 0, failed: 0 }, 200);
    }

    let sent = 0;
    let failed = 0;

    for (const job of claimedJobs) {
      phase = "job";
      if (isTerminalStatus(job.status)) {
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

      phase = "send";
      const sendResult = await sendTwilioMessage({
        accountSid: twilioAccountSid,
        authToken: twilioAuthToken,
        to: job.to_e164,
        from: fromE164,
        body: plaintext as string,
        messagingServiceSid: twilioMessagingServiceSid,
        statusCallbackUrl,
      });

      if (!sendResult.ok) {
        failed += 1;
        await markJobFailure(
          supabase,
          job,
          sendResult.errorMessage,
          sendResult.retryable
        );
        continue;
      }

      const twilioSid = sendResult.sid;
      sent += 1;

      await markJobSent(supabase, job, twilioSid, sendResult.status);
      await ensureSmsMessage(
        supabase,
        job,
        fromE164,
        twilioSid,
        sendResult.status ?? "queued"
      );
    }

    return jsonResponse({
      ok: true,
      processed: claimedJobs.length,
      sent,
      failed,
    });
  } catch (error) {
    const err = error as Error;
    console.error("sms_outbound.unhandled_error", {
      request_id: requestId,
      phase,
      name: err?.name ?? "Error",
      message: err?.message ?? String(error),
      stack: err?.stack ?? null,
    });
    return jsonResponse({ error: "Internal error" }, 500);
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

async function markJobSent(
  supabase: ReturnType<typeof createClient>,
  job: SmsOutboundJob,
  sid: string,
  status: string | null,
  incrementAttempts = true
): Promise<void> {
  const { error } = await supabase
    .from("sms_outbound_jobs")
    .update({
      status: "sent",
      twilio_message_sid: sid,
      last_error: null,
      last_status_at: new Date().toISOString(),
      attempts: incrementAttempts ? job.attempts + 1 : job.attempts,
      next_attempt_at: null,
    })
    .eq("id", job.id);

  if (error) {
    console.error("sms_outbound.job_update_failed", {
      job_id: job.id,
      error: error.message,
      status,
    });
  }
}

async function markJobFailure(
  supabase: ReturnType<typeof createClient>,
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
    .eq("id", job.id);

  if (error) {
    console.error("sms_outbound.job_failure_update_failed", {
      job_id: job.id,
      error: error.message,
    });
  }
}

async function ensureSmsMessage(
  supabase: ReturnType<typeof createClient>,
  job: SmsOutboundJob,
  fromE164: string | null,
  sid: string,
  status: string
): Promise<void> {
  if (!fromE164) {
    console.error("sms_outbound.missing_from_for_message", { job_id: job.id });
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
        body_iv: null,
        body_tag: null,
        key_version: job.key_version,
        media_count: 0,
        status,
        last_status_at: new Date().toISOString(),
        correlation_id: job.correlation_id,
      },
      { onConflict: "twilio_message_sid", ignoreDuplicates: true }
    );

  if (error) {
    console.error("sms_outbound.sms_message_insert_failed", {
      job_id: job.id,
      error: error.message,
      twilio_sid: sid,
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

type TwilioSendInput = {
  accountSid: string;
  authToken: string;
  to: string;
  from: string;
  body: string;
  messagingServiceSid: string | null;
  statusCallbackUrl: string | null;
};

type TwilioSendResult =
  | {
      ok: true;
      sid: string;
      status: string | null;
    }
  | {
      ok: false;
      retryable: boolean;
      errorMessage: string;
    };

async function sendTwilioMessage(
  input: TwilioSendInput
): Promise<TwilioSendResult> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${input.accountSid}/Messages.json`;
  const payload = new URLSearchParams();
  payload.set("To", input.to);
  payload.set("Body", input.body);

  if (input.messagingServiceSid) {
    payload.set("MessagingServiceSid", input.messagingServiceSid);
  } else {
    payload.set("From", input.from);
  }

  if (input.statusCallbackUrl) {
    payload.set("StatusCallback", input.statusCallbackUrl);
  }

  const auth = btoa(`${input.accountSid}:${input.authToken}`);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: payload.toString(),
    });

    const json = await response.json().catch(() => null);

    if (!response.ok) {
      const errorCode = json?.code ? `code=${json.code}` : null;
      const errorMessage = json?.message ?? response.statusText;
      const retryable = isRetryableStatus(response.status);
      return {
        ok: false,
        retryable,
        errorMessage: [errorCode, errorMessage].filter(Boolean).join(" "),
      };
    }

    const sid = json?.sid as string | undefined;
    if (!sid) {
      return {
        ok: false,
        retryable: false,
        errorMessage: "Twilio response missing sid",
      };
    }

    return {
      ok: true,
      sid,
      status: json?.status ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      retryable: true,
      errorMessage: (error as Error)?.message ?? "Twilio request failed",
    };
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

function resolveStatusCallbackUrl(): string | null {
  const explicit = Deno.env.get("TWILIO_STATUS_CALLBACK_URL");
  if (explicit) {
    return explicit;
  }

  const projectRef = Deno.env.get("PROJECT_REF");
  if (!projectRef) {
    return null;
  }

  return `https://${projectRef}.supabase.co/functions/v1/twilio-status-callback`;
}

function jsonResponse(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

async function verifyQstashRequest(req: Request): Promise<Response | null> {
  const signature = req.headers.get("Upstash-Signature");
  if (!signature) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const body = await req.text();
  const currentKey = requireEnv("QSTASH_CURRENT_SIGNING_KEY");
  const nextKey = requireEnv("QSTASH_NEXT_SIGNING_KEY");
  const projectRef = requireEnv("PROJECT_REF");
  const expectedUrl = `https://${projectRef}.supabase.co/functions/v1/twilio-outbound-runner`;

  const receiver = new Receiver({
    currentSigningKey: currentKey,
    nextSigningKey: nextKey,
  });

  try {
    await receiver.verify({
      signature,
      body,
      url: expectedUrl,
    });
  } catch {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const subject = decodeJwtSubject(signature);
  if (!subject || subject !== expectedUrl) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  return null;
}

function decodeJwtSubject(token: string): string | null {
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }
  const payload = decodeBase64Url(parts[1]);
  if (!payload) {
    return null;
  }
  try {
    const parsed = JSON.parse(payload) as { sub?: string };
    return typeof parsed.sub === "string" ? parsed.sub : null;
  } catch {
    return null;
  }
}

function decodeBase64Url(value: string): string | null {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  try {
    return atob(padded + padding);
  } catch {
    return null;
  }
}
