import Stripe from "stripe";
import type { Database, Json } from "../../../../supabase/types/database";
import { logEvent } from "../../../lib/observability";
import { getStripeClient } from "../../../lib/stripe";
import { getSupabaseServiceRoleClient } from "../../../lib/supabase-service-role";

export const runtime = "nodejs";

type SupportedSubscriptionEventType =
  | "checkout.session.completed"
  | "customer.subscription.created"
  | "customer.subscription.updated"
  | "customer.subscription.deleted";

type NormalizedSubscriptionState = {
  userId: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

type ExistingSubscriptionState = Pick<
  Database["public"]["Tables"]["subscriptions"]["Row"],
  | "user_id"
  | "stripe_customer_id"
  | "status"
  | "current_period_end"
  | "cancel_at_period_end"
>;

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

function isSupportedSubscriptionEventType(
  eventType: string
): eventType is SupportedSubscriptionEventType {
  return (
    eventType === "checkout.session.completed" ||
    eventType === "customer.subscription.created" ||
    eventType === "customer.subscription.updated" ||
    eventType === "customer.subscription.deleted"
  );
}

function coerceNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function coerceStripeIdentifier(value: unknown): string | null {
  const direct = coerceNonEmptyString(value);
  if (direct) {
    return direct;
  }

  if (value && typeof value === "object" && "id" in value) {
    return coerceNonEmptyString((value as { id?: unknown }).id);
  }

  return null;
}

function toSafeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim().slice(0, 240);
  }
  return "Stripe webhook processing failed.";
}

function extractSubscriptionStateFromEvent(
  event: Stripe.Event
): NormalizedSubscriptionState | null {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const stripeSubscriptionId = coerceStripeIdentifier(session.subscription);
    if (!stripeSubscriptionId) {
      return null;
    }

    return {
      userId:
        coerceNonEmptyString(session.metadata?.user_id) ??
        coerceNonEmptyString(session.client_reference_id),
      stripeCustomerId: coerceStripeIdentifier(session.customer),
      stripeSubscriptionId,
      status: "checkout_completed",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    };
  }

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const subscription = event.data.object as Stripe.Subscription;
    const firstItemCurrentPeriodEnd = subscription.items?.data?.[0]?.current_period_end;
    const stripeSubscriptionId = coerceNonEmptyString(subscription.id);
    if (!stripeSubscriptionId) {
      return null;
    }

    return {
      userId: coerceNonEmptyString(subscription.metadata?.user_id),
      stripeCustomerId: coerceStripeIdentifier(subscription.customer),
      stripeSubscriptionId,
      status:
        event.type === "customer.subscription.deleted"
          ? "canceled"
          : coerceNonEmptyString(subscription.status) ?? "unknown",
      currentPeriodEnd:
        typeof firstItemCurrentPeriodEnd === "number"
          ? new Date(firstItemCurrentPeriodEnd * 1000).toISOString()
          : null,
      cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    };
  }

  return null;
}

async function fetchExistingSubscriptionState(
  stripeSubscriptionId: string
): Promise<ExistingSubscriptionState | null> {
  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("subscriptions")
    .select("user_id,stripe_customer_id,status,current_period_end,cancel_at_period_end")
    .eq("stripe_subscription_id", stripeSubscriptionId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to load existing subscription state (${error.code ?? "unknown"})`
    );
  }

  return data;
}

async function persistSubscriptionLifecycleState(event: Stripe.Event): Promise<void> {
  if (!isSupportedSubscriptionEventType(event.type)) {
    return;
  }

  const extracted = extractSubscriptionStateFromEvent(event);
  if (!extracted) {
    return;
  }

  const existing = await fetchExistingSubscriptionState(extracted.stripeSubscriptionId);

  const mergedUserId = extracted.userId ?? existing?.user_id ?? null;
  const mergedStripeCustomerId =
    extracted.stripeCustomerId ?? existing?.stripe_customer_id ?? null;
  const mergedCurrentPeriodEnd = extracted.currentPeriodEnd ?? existing?.current_period_end ?? null;
  const mergedCancelAtPeriodEnd =
    event.type === "checkout.session.completed" && existing
      ? existing.cancel_at_period_end
      : extracted.cancelAtPeriodEnd;
  const mergedStatus =
    event.type === "checkout.session.completed" && existing
      ? existing.status
      : extracted.status;

  const supabase = getSupabaseServiceRoleClient();
  const { error } = await supabase.from("subscriptions").upsert(
    {
      user_id: mergedUserId,
      stripe_customer_id: mergedStripeCustomerId,
      stripe_subscription_id: extracted.stripeSubscriptionId,
      status: mergedStatus,
      current_period_end: mergedCurrentPeriodEnd,
      cancel_at_period_end: mergedCancelAtPeriodEnd,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "stripe_subscription_id" }
  );

  if (error) {
    throw new Error(`Failed to persist subscription state (${error.code ?? "unknown"})`);
  }
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
    await persistSubscriptionLifecycleState(event);
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
