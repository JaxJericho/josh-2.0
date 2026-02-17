import Stripe from "stripe";
import { getStripeClient } from "../../../lib/stripe";

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

  try {
    const stripe = getStripeClient();
    const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);

    // Intentionally acknowledge all valid events for now.
    // Event-specific handling and persistence are implemented in a follow-up ticket.
    return json(
      {
        ok: true,
        received: true,
        eventType: event.type,
      },
      200
    );
  } catch (error) {
    if (isStripeSignatureError(error)) {
      return json(
        {
          ok: false,
          error: "Invalid Stripe signature.",
        },
        400
      );
    }

    return json(
      {
        ok: false,
        error: "Internal webhook processing error.",
      },
      500
    );
  }
}
