import Stripe from "stripe";
import type { Json } from "../../../../supabase/types/database";
import { logEvent } from "../../../lib/observability";
import { getStripeClient } from "../../../lib/stripe";
import { getSupabaseServiceRoleClient } from "../../../lib/supabase-service-role";

export const runtime = "nodejs";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function getWebhookSecret(): string | null {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  return secret && secret.length > 0 ? secret : null;
}

function isStripeSignatureError(error: unknown): boolean {
  return error instanceof Stripe.errors.StripeSignatureVerificationError;
}

function isDuplicateInsertError(error: { code?: string | null }): boolean {
  return error.code === "23505";
}

function toSafeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim().slice(0, 240);
  }
  return "Stripe webhook processing failed.";
}

async function insertStripeEvent(event: Stripe.Event): Promise<{
  duplicate: boolean;
}> {
  const supabase = getSupabaseServiceRoleClient();
  const { error } = await supabase.from("stripe_events").insert({
    event_id: event.id,
    event_type: event.type,
    event_created_at: new Date(event.created * 1000).toISOString(),
    payload: event as unknown as Json,
  });

  if (!error) {
    return { duplicate: false };
  }

  if (isDuplicateInsertError(error)) {
    return { duplicate: true };
  }

  throw new Error(`Failed to persist Stripe event (${error.code ?? "unknown"})`);
}

async function markStripeEventProcessed(eventId: string): Promise<void> {
  const supabase = getSupabaseServiceRoleClient();
  const { error } = await supabase
    .from("stripe_events")
    .update({
      processed_at: new Date().toISOString(),
      processing_error: null,
    })
    .eq("event_id", eventId);

  if (error) {
    throw new Error(`Failed to mark Stripe event processed (${error.code ?? "unknown"})`);
  }
}

async function markStripeEventFailed(eventId: string, processingError: string): Promise<void> {
  const supabase = getSupabaseServiceRoleClient();
  const { error } = await supabase
    .from("stripe_events")
    .update({
      processed_at: null,
      processing_error: processingError,
    })
    .eq("event_id", eventId);

  if (error) {
    throw new Error(`Failed to mark Stripe event failed (${error.code ?? "unknown"})`);
  }
}

export async function POST(request: Request): Promise<Response> {
  const webhookSecret = getWebhookSecret();
  if (!webhookSecret) {
    return json(
      {
        ok: false,
        error: "Webhook endpoint is not configured.",
      },
      500
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return json(
      {
        ok: false,
        error: "Invalid Stripe signature.",
      },
      400
    );
  }

  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    const stripe = getStripeClient();
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    if (isStripeSignatureError(error)) {
      logEvent({
        level: "warn",
        event: "stripe.webhook.invalid_signature",
        handler: "api/stripe/webhook",
        status_code: 400,
      });
      return json(
        {
          ok: false,
          error: "Invalid Stripe signature.",
        },
        400
      );
    }
    logEvent({
      level: "error",
      event: "stripe.webhook.signature_verification_failed",
      handler: "api/stripe/webhook",
      status_code: 500,
      error_message: toSafeErrorMessage(error),
    });
    return json(
      {
        ok: false,
        error: "Internal webhook processing error.",
      },
      500
    );
  }

  let inserted = false;
  try {
    const insertResult = await insertStripeEvent(event);
    if (insertResult.duplicate) {
      logEvent({
        level: "info",
        event: "stripe.webhook.duplicate",
        handler: "api/stripe/webhook",
        stripe_event_id: event.id,
        stripe_event_type: event.type,
        status_code: 200,
      });
      return json(
        {
          ok: true,
          duplicate: true,
        },
        200
      );
    }

    inserted = true;
    await markStripeEventProcessed(event.id);
    logEvent({
      level: "info",
      event: "stripe.webhook.ingested",
      handler: "api/stripe/webhook",
      stripe_event_id: event.id,
      stripe_event_type: event.type,
      status_code: 200,
    });

    return json(
      {
        ok: true,
      },
      200
    );
  } catch (error) {
    const safeMessage = toSafeErrorMessage(error);
    if (inserted) {
      try {
        await markStripeEventFailed(event.id, safeMessage);
      } catch (markError) {
        logEvent({
          level: "error",
          event: "stripe.webhook.mark_failed_write_error",
          handler: "api/stripe/webhook",
          stripe_event_id: event.id,
          status_code: 500,
          error_message: toSafeErrorMessage(markError),
        });
      }
    }

    logEvent({
      level: "error",
      event: "stripe.webhook.ingest_failed",
      handler: "api/stripe/webhook",
      stripe_event_id: event.id,
      stripe_event_type: event.type,
      status_code: 500,
      error_message: safeMessage,
    });

    return json(
      {
        ok: false,
        error: "Internal webhook processing error.",
      },
      500
    );
  }
}
