import { logEvent } from "../../../lib/observability";
import { getStripeClient } from "../../../lib/stripe";

export const runtime = "nodejs";

type CheckoutRequestBody = {
  user_id?: unknown;
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function getStripeCheckoutConfig(): { priceId: string } | null {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  const priceId = process.env.STRIPE_PRICE_ID?.trim();

  if (!secretKey || !priceId) {
    return null;
  }

  return { priceId };
}

function toSafeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim().slice(0, 240);
  }

  return "Stripe checkout session creation failed.";
}

async function findExistingStripeCustomerId(userId: string): Promise<string | null> {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  const query = `${supabaseUrl}/rest/v1/stripe_customers?select=stripe_customer_id&user_id=eq.${encodeURIComponent(
    userId
  )}&limit=1`;

  try {
    const response = await fetch(query, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    });

    // If the mapping table is absent or inaccessible, fall back to Stripe auto-customer creation.
    if (!response.ok) {
      return null;
    }

    const rows = (await response.json()) as Array<{ stripe_customer_id?: string | null }>;
    const customerId = rows[0]?.stripe_customer_id;

    if (!customerId || customerId.trim().length === 0) {
      return null;
    }

    return customerId;
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  const config = getStripeCheckoutConfig();
  if (!config) {
    return json(
      {
        ok: false,
        error: "Checkout endpoint is not configured.",
      },
      500
    );
  }

  let body: CheckoutRequestBody;
  try {
    body = (await request.json()) as CheckoutRequestBody;
  } catch {
    return json(
      {
        ok: false,
        error: "Invalid request body.",
      },
      400
    );
  }

  const userId =
    typeof body.user_id === "string" && body.user_id.trim().length > 0
      ? body.user_id.trim()
      : null;

  if (!userId) {
    return json(
      {
        ok: false,
        error: "Missing required field: user_id.",
      },
      400
    );
  }

  try {
    const stripe = getStripeClient();
    const origin = new URL(request.url).origin;
    const existingCustomerId = await findExistingStripeCustomerId(userId);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: config.priceId, quantity: 1 }],
      success_url: `${origin}/dashboard?checkout=success`,
      cancel_url: `${origin}/dashboard?checkout=cancel`,
      metadata: { user_id: userId },
      subscription_data: {
        metadata: { user_id: userId },
      },
      client_reference_id: userId,
      ...(existingCustomerId ? { customer: existingCustomerId } : {}),
    });

    if (!session.url) {
      throw new Error("Stripe checkout session URL was not returned.");
    }

    return json({ url: session.url }, 200);
  } catch (error) {
    logEvent({
      level: "error",
      event: "stripe.checkout.create_failed",
      handler: "api/stripe/checkout",
      status_code: 500,
      error_message: toSafeErrorMessage(error),
    });

    return json(
      {
        ok: false,
        error: "Internal checkout error.",
      },
      500
    );
  }
}
